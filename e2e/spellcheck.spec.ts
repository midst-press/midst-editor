import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import { launch, openDocument, readStore, waitUntil } from './harness';

// Does switching spellcheck on leave the poet in their poem?
//
// The toggle reloads the window so that the whole text is checked again. The reload used to start the
// app at its opening screen, with the poem still open underneath and the poet no longer in it (#86).
// Invented letters only.

const toggleSpellcheck = (app: Awaited<ReturnType<typeof launch>>['app']) =>
  app.evaluate(({ BrowserWindow }) =>
    // What the View menu's spellcheck item sends.
    BrowserWindow.getAllWindows()[0].webContents.send('toggle-spellcheck')
  );

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
