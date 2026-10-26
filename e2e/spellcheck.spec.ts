import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import {
  checkSpellingMark,
  clickCheckSpelling,
  launch,
  openDocument,
  readStore,
  waitUntil,
} from './harness';

// Does switching spellcheck on leave the poet in their poem?
//
// The toggle reloads the window so that the whole text is checked again. The reload used to start the
// app at its opening screen, with the poem still open underneath and the poet no longer in it (#86).
// Invented letters only.

// The real Edit > Check Spelling item: it owns the setting and its checkmark (editor #320).
const toggleSpellcheck = clickCheckSpelling;

test('toggling spellcheck comes back to the poem, with the setting applied', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-spellcheck-stay-'));
  const doc = makeMidst('STAYS', 0);
  const poemPath = join(work, 'stay.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem');
    const editor = win.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 25_000 });
    // CONTROL: spellcheck starts off, so "true" below was put there by the toggle.
    await expect(editor).toHaveAttribute('spellcheck', 'false');
    await editor.click();
    await win.keyboard.type('zqx');

    await toggleSpellcheck(app);
    expect(
      await waitUntil(() => readStore(userData).spellcheck === 'true', 10_000),
      'the spellcheck setting never changed'
    ).toBe(true);

    await expect(
      win.locator('.ProseMirror'),
      'after the toggle the poet is not in the editor'
    ).toBeVisible({ timeout: 25_000 });
    await expect(win.locator('.ProseMirror')).toHaveAttribute(
      'spellcheck',
      'true'
    );
    await expect(win.locator('.ProseMirror')).toContainText('zqx');

    // And off again, the same way.
    await toggleSpellcheck(app);
    expect(
      await waitUntil(() => readStore(userData).spellcheck === 'false', 10_000),
      'the spellcheck setting never changed back'
    ).toBe(true);
    await expect(win.locator('.ProseMirror')).toHaveAttribute(
      'spellcheck',
      'false',
      { timeout: 25_000 }
    );
    await expect(win.locator('.ProseMirror')).toContainText('zqx');
  } finally {
    await app.close();
  }
});

test('a fresh start still shows the opening screen, not the editor', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-spellcheck-fresh-'));
  const { app } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expect(win.locator('#root')).not.toBeEmpty({ timeout: 25_000 });
    await win.waitForTimeout(1_500);
    expect(await win.locator('.ProseMirror').count()).toBe(0);
  } finally {
    await app.close();
  }
});

// The poem's own text drawn transparent, so a count sees only what Chromium draws for it, the spelling marks.
// On GitHub's Ubuntu runner 49 pixels in the box counted as red with spellcheck off; the text is the only thing
// drawn there, and its antialiasing is the likely source. Toggling spellcheck reloads the window, so this is
// applied again after it.
const hideText = async (
  win: Awaited<
    ReturnType<Awaited<ReturnType<typeof launch>>['app']['firstWindow']>
  >
) => {
  await win.addStyleTag({
    content:
      '.ProseMirror, .ProseMirror * { color: transparent !important; caret-color: transparent !important; }',
  });
  // CONTROL: the style reached the poem.
  await expect(win.locator('.ProseMirror')).toHaveCSS(
    'color',
    'rgba(0, 0, 0, 0)'
  );
};

// Red underline pixels in the editor, read in the main process from the window itself. Spelling marks are
// drawn by Chromium below the DOM, so nothing in the page can see them. The thresholds are Silas's, calibrated
// on #238: 0 before any typing, every misspelled word marked after.
const redPixels = async (
  app: Awaited<ReturnType<typeof launch>>['app'],
  win: Awaited<
    ReturnType<Awaited<ReturnType<typeof launch>>['app']['firstWindow']>
  >
) => {
  const box = await win.locator('.ProseMirror').boundingBox();
  if (!box) throw new Error('the editor has no box');
  return app.evaluate(
    async ({ BrowserWindow }, rect) => {
      const image =
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect);
      const bgra = image.toBitmap();
      let n = 0;
      for (let i = 0; i < bgra.length; i += 4) {
        const [b, g, r] = [bgra[i], bgra[i + 1], bgra[i + 2]];
        if (r > 180 && r - g > 60 && r - b > 60) n += 1;
      }
      return n;
    },
    {
      x: Math.floor(box.x),
      y: Math.floor(box.y),
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
    }
  );
};

test('switching spellcheck on marks the misspelled words before anything is typed, and changes nothing (#238)', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-spellcheck-marks-'));
  const poemPath = join(work, 'marks.midst');
  writeFileSync(poemPath, makeMidst('Thsi wrod isz badd', 0).file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem');
    const editor = win.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 25_000 });
    // CONTROL: with spellcheck off nothing is red, so red below is the marks.
    await hideText(win);
    await win.waitForTimeout(1_000);
    expect(await redPixels(app, win)).toBe(0);

    await toggleSpellcheck(app);
    expect(
      await waitUntil(() => readStore(userData).spellcheck === 'true', 10_000),
      'the spellcheck setting never changed'
    ).toBe(true);
    await expect(win.locator('.ProseMirror')).toHaveAttribute(
      'spellcheck',
      'true',
      {
        timeout: 25_000,
      }
    );
    const stored = readStore(userData);

    await hideText(win);
    await expect
      .poll(() => redPixels(app, win), {
        message: 'no word was marked before typing',
        timeout: 5_000,
      })
      .toBeGreaterThan(0);

    // The edit that made Chromium look is in neither the poem nor its history, nor does an undo bring it back.
    await expect(win.locator('.ProseMirror')).toHaveText('Thsi wrod isz badd');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.undo()
    );
    await win.waitForTimeout(1_000);
    await expect(win.locator('.ProseMirror')).toHaveText('Thsi wrod isz badd');
    const after = readStore(userData);
    expect([after.poem, after.history, after.edited]).toEqual([
      stored.poem,
      stored.history,
      stored.edited,
    ]);
  } finally {
    await app.close();
  }
});

// The mark and the setting agree wherever the poet is (GitHub #80, editor #320). Only the writing screen
// listens for the toggle, so in Timeline mode the menu has to change the setting itself; the writing screen
// applies it when the poet returns.
test('Check Spelling from Timeline mode changes the setting and its checkmark, applied on returning to Edit', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-spellcheck-timeline-'));
  const doc = makeMidst('TIMELINE', 0);
  const poemPath = join(work, 'timeline.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    // CONTROL: off, and the mark says so.
    expect(await checkSpellingMark(app)).toBe(false);

    await win.getByRole('button', { name: 'Timeline' }).click();
    await expect(win.locator('.ReplayContainer')).toBeVisible({
      timeout: 25_000,
    });
    await clickCheckSpelling(app);
    expect(
      await waitUntil(() => readStore(userData).spellcheck === 'true', 10_000),
      'Check Spelling in Timeline mode did not change the setting'
    ).toBe(true);
    expect(
      await checkSpellingMark(app),
      'the mark disagrees with the setting'
    ).toBe(true);

    await win.getByRole('button', { name: 'Edit' }).click();
    await expect(win.locator('.ProseMirror')).toHaveAttribute(
      'spellcheck',
      'true',
      { timeout: 25_000 }
    );
  } finally {
    await app.close();
  }
});
