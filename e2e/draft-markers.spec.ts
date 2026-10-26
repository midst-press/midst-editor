import { test, expect, Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makePlayableMidst } from './fixtures';
import { launch, openDocument, waitUntil } from './harness';

// Can a poet mark a draft, name it, and delete it, and is that what the saved file holds?
//
// Driven through the real controls and checked in the FILE, because the file is what a poet keeps.
// Invented sentences only.

// More than 50 recorded changes: the original editor allowed markers only past that.
const LONG =
  'the quick brown fox jumps over the lazy dog and then sleeps for a while';
const SHORT = 'a short line';

const metaOnDisk = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8').split('\n').slice(1).join('\n')).meta;
const MARK = 'Add a Draft Marker here';

test('a draft is marked from the editor, named, joined by a second, and deleted', async () => {
  const doc = makePlayableMidst(LONG);
  const last = doc.history.length - 1;
  expect(
    doc.history.length,
    'the fixture needs more than 50 changes'
  ).toBeGreaterThan(50);

  const work = mkdtempSync(join(tmpdir(), 'midst-drafts-'));
  const poemPath = join(work, 'drafts.midst');
  writeFileSync(poemPath, doc.file);
  // CONTROL: the file starts with no meta at all, so every marker below was put there by the app.
  expect(metaOnDisk(poemPath)).toBeUndefined();

  const { app, userData } = await launch(work);
  const failures: string[] = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => failures.push(`pageerror: ${String(e)}`));
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the long poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });

    // 1. From the editor: marks the latest moment and goes to the replay with the name open.
    await win.getByRole('button', { name: MARK }).click();
    const nameField = win.getByLabel('Draft Marker name');
    await expect(nameField, 'the name did not open for typing').toBeVisible({
      timeout: 25_000,
    });
    await expect(nameField).toHaveValue('Draft 1');
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath)?.draftMarkers?.length === 1,
        10_000
      ),
      'the new marker never reached the file'
    ).toBe(true);
    expect(metaOnDisk(poemPath)).toEqual({
      draftMarkers: [{ index: last, defaultName: 'Draft 1' }],
      highestDraftNumber: 1,
    });

    // 2. Name it. Space and Enter are typed into the name, not taken as play and pause.
    await nameField.fill('zq xv');
    await nameField.press('Enter');
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath).draftMarkers[0].name === 'zq xv',
        10_000
      ),
      'the name never reached the file'
    ).toBe(true);
    await expect(win.locator('.DraftDrawer .draft-name')).toHaveText(['zq xv']);
    await expect(
      win.locator('.ReplayContainer'),
      'naming a draft left the replay'
    ).toBeVisible();

    // 3. One marker per moment: here the button is off. One step earlier it is on.
    await win.keyboard.press('Escape');
    await expect(win.locator('.DraftDrawer')).toBeHidden();
    const mark = win.getByRole('button', { name: MARK });
    await expect(mark).toBeDisabled();

    // With the list open and nothing in it touched yet, the keys still do not reach playback: Space
    // and Enter used to start it behind the list, because focus sits on the drawer, not inside it.
    const thumb = win.locator('.MuiSlider-thumb input');
    await expect(thumb).toHaveValue(String(last));
    await win.getByRole('button', { name: 'Draft Markers' }).click();
    await expect(win.locator('.DraftDrawer')).toBeVisible();
    // One key at a time: the two together would start playback and stop it again. Read once, not
    // with a retrying expect: a retry would wait until the playback it is meant to catch had run to
    // the end and put the slider back where it started.
    const pressAndRead = async (key: string) => {
      await win.keyboard.press(key);
      await win.waitForTimeout(700);
      return [
        await thumb.inputValue(),
        await win.locator('[data-testid="PauseIcon"]').count(),
      ];
    };
    expect(
      await pressAndRead('Space'),
      'Space started playback behind the open list'
    ).toEqual([String(last), 0]);
    expect(
      await pressAndRead('Enter'),
      'Enter started playback behind the open list'
    ).toEqual([String(last), 0]);
    await win.keyboard.press('Escape');
    await expect(win.locator('.DraftDrawer')).toBeHidden();
    await expect(win.locator('.ReplayContainer')).toBeVisible();
    await expect(win.locator('.MuiSlider-mark')).toHaveCount(1);
    await win.locator('.MuiSlider-thumb input').press('ArrowLeft');
    await expect(mark).toBeEnabled();
    await mark.click();
    await expect(win.getByLabel('Draft Marker name')).toHaveValue('Draft 2');
    await win.getByLabel('Draft Marker name').press('Enter');
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath).draftMarkers.length === 2,
        10_000
      ),
      'the second marker never reached the file'
    ).toBe(true);
    expect(metaOnDisk(poemPath)).toEqual({
      draftMarkers: [
        { index: last, name: 'zq xv', defaultName: 'Draft 1' },
        { index: last - 1, name: 'Draft 2', defaultName: 'Draft 2' },
      ],
      highestDraftNumber: 2,
    });
    // Newest first in the list.
    await expect(win.locator('.DraftDrawer .draft-name')).toHaveText([
      'Draft 2',
      'zq xv',
    ]);

    // 4. Delete the first one: gone from the file at once, and its number is not given out again.
    await win
      .getByRole('button', { name: 'Delete Draft Marker' })
      .nth(1)
      .click();
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath).draftMarkers.length === 1,
        10_000
      ),
      'the delete never reached the file'
    ).toBe(true);
    expect(metaOnDisk(poemPath)).toEqual({
      draftMarkers: [
        { index: last - 1, name: 'Draft 2', defaultName: 'Draft 2' },
      ],
      highestDraftNumber: 2,
    });

    // The poem itself is untouched by all of this.
    const saved = JSON.parse(
      readFileSync(poemPath, 'utf8').split('\n').slice(1).join('\n')
    );
    expect(saved.text).toBe(doc.finalHtml);
    expect(saved.history).toHaveLength(doc.history.length);
    expect(failures, failures.join('\n')).toEqual([]);
  } finally {
    await app.close();
  }
});

// The editor saves a second after the last keystroke. Going to the replay inside that second leaves
// the stored text behind what the replay shows, so a marker on the last moment must take the text and
// history to the file with it, or the file holds a marker that points past its own history.
test('a marker made in the replay straight after typing does not point past the saved history', async () => {
  const doc = makePlayableMidst(LONG);
  const work = mkdtempSync(join(tmpdir(), 'midst-drafts-typed-'));
  const poemPath = join(work, 'typed.midst');
  writeFileSync(poemPath, doc.file);
  const savedDoc = () =>
    JSON.parse(readFileSync(poemPath, 'utf8').split('\n').slice(1).join('\n'));

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem to type in');
    const editor = win.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 25_000 });

    await editor.click();
    await win.keyboard.type('zqx');
    await win.getByRole('link', { name: 'Timeline' }).click();
    await expect(win.locator('.ReplayContainer')).toBeVisible({
      timeout: 25_000,
    });
    await win.getByRole('button', { name: MARK }).click();
    await expect(win.getByLabel('Draft Marker name')).toBeVisible();

    expect(
      await waitUntil(
        () => savedDoc().meta?.draftMarkers?.length === 1,
        10_000
      ),
      'the marker never reached the file'
    ).toBe(true);
    const saved = savedDoc();
    // CONTROL: the typing was recorded at all, so the marker is on a moment made after the open.
    expect(saved.meta.draftMarkers[0].index).toBeGreaterThanOrEqual(
      doc.history.length
    );
    expect(
      saved.history.length,
      'the file holds a marker that points past its own history'
    ).toBeGreaterThan(saved.meta.draftMarkers[0].index);
    expect(saved.meta.draftMarkers[0].index).toBe(saved.history.length - 1);
    expect(saved.text).toContain('zqx');
  } finally {
    await app.close();
  }
});

test('a poem with 50 or fewer changes cannot be marked yet', async () => {
  const doc = makePlayableMidst(SHORT);
  expect(doc.history.length).toBeLessThanOrEqual(50);
  const work = mkdtempSync(join(tmpdir(), 'midst-drafts-short-'));
  const poemPath = join(work, 'short.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the short poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await expect(win.getByRole('button', { name: MARK })).toBeDisabled();
    await win.getByRole('link', { name: 'Timeline' }).click();
    await expect(win.locator('.ReplayContainer')).toBeVisible({
      timeout: 25_000,
    });
    await expect(win.getByRole('button', { name: MARK })).toBeDisabled();
    expect(metaOnDisk(poemPath)).toBeUndefined();
  } finally {
    await app.close();
  }
});

// #313 (GitHub #85): naming a draft must not hide the poem, and the drafts list must cover neither the poem nor the
// timeline. Measured in the real window, at the size it opens at and at a narrow one: the list's box is clear of the
// title bar, the poem and the control bar, nothing is dimmed, and what is under the middle of the poem and the right
// end of the timeline is the replay's own, not the list.
type Box = { x: number; y: number; width: number; height: number };
const right = (b: Box) => b.x + b.width;

async function expectBeside(win: Page) {
  const layout = await win.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const poem = box('.HistoryDisplay');
    const rail = box('.ControlBar .MuiSlider-root');
    const under = (x: number, y: number) =>
      Boolean(document.elementFromPoint(x, y)?.closest('.ReplayMain'));
    return {
      viewport: window.innerWidth,
      bar: box('.cet-titlebar'),
      heading: box('.DraftDrawer h2'),
      panel: box('.DraftDrawer'),
      poem,
      controls: box('.ControlBar'),
      backdrop: document.querySelector('.MuiBackdrop-root') !== null,
      poemShows: under(poem.x + poem.width / 2, poem.y + poem.height / 2),
      railEndShows: under(rail.x + rail.width - 2, rail.y + rail.height / 2),
    };
  });
  const at = `at width ${layout.viewport}`;
  expect(layout.backdrop, `${at}: something is dimmed`).toBe(false);
  expect(
    layout.panel.x,
    `${at}: the list covers the poem`
  ).toBeGreaterThanOrEqual(right(layout.poem) - 0.5);
  expect(
    layout.panel.x,
    `${at}: the list covers the timeline`
  ).toBeGreaterThanOrEqual(right(layout.controls) - 0.5);
  expect(
    right(layout.panel),
    `${at}: the list runs off the window`
  ).toBeLessThanOrEqual(layout.viewport + 0.5);
  expect(
    layout.heading.y,
    `${at}: the title bar covers the list's heading`
  ).toBeGreaterThanOrEqual(layout.bar.y + layout.bar.height - 0.5);
  expect(layout.poemShows, `${at}: the middle of the poem is covered`).toBe(
    true
  );
  expect(layout.railEndShows, `${at}: the end of the timeline is covered`).toBe(
    true
  );
}

test('the drafts list sits beside the poem and the timeline, covering neither', async () => {
  const doc = makePlayableMidst(LONG);
  const work = mkdtempSync(join(tmpdir(), 'midst-drafts-beside-'));
  const poemPath = join(work, 'beside.midst');
  writeFileSync(poemPath, doc.file);
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the long poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await win.getByRole('button', { name: MARK }).click();
    await expect(win.getByLabel('Draft Marker name')).toBeVisible({
      timeout: 25_000,
    });

    await expectBeside(win);
    await win.screenshot({ path: test.info().outputPath('drafts-beside.png') });

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(900, 600);
    });
    await win.waitForFunction(() => window.innerWidth === 900);
    await expectBeside(win);
    await win.screenshot({
      path: test.info().outputPath('drafts-beside-900.png'),
    });
  } finally {
    await app.close();
  }
});
