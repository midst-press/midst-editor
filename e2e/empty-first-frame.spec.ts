import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reconstructHTML } from '@midst-press/midst-format/history';
import type { ChangeObj } from '@midst-press/midst-format/history';
import { parseMidst } from './fixtures';
import { clickMenuItem, launch, readStore, waitUntil } from './harness';

// GitHub #29 (editor #139): a new poem's Timeline begins at an empty page. The oracle is the file on disk, which is
// what the website player reads: its first frame must reconstruct to nothing, and the next to the first text typed.
test('a new poem is saved with an empty first frame before its first text', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-first-frame-'));
  const pathNew = join(work, 'first-frame.midst');
  const TYPED = 'zq';

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    // New opens an Untitled poem with nothing asked (#315); Save then asks where, answered with the path.
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialogSync = (() =>
        p) as unknown as typeof dialog.showSaveDialogSync;
    }, pathNew);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.emit('new-file', {});
    });

    const pm = win.locator('.ProseMirror');
    await expect(pm).toBeVisible({ timeout: 25_000 });
    await pm.click();
    await win.keyboard.type(TYPED, { delay: 60 });
    // CONTROL: the keystrokes reached the editor, so an empty file below is not a typing failure.
    expect(await pm.innerText()).toContain(TYPED);
    await clickMenuItem(app, 'menu.file.save');
    expect(
      await waitUntil(() => readStore(userData).filename === pathNew, 25_000),
      'Save did not name the poem'
    ).toBe(true);

    const saved = () => {
      try {
        return parseMidst(readFileSync(pathNew, 'utf8'));
      } catch {
        return null;
      }
    };
    expect(
      await waitUntil(() => (saved()?.text ?? '').includes(TYPED), 15_000),
      'the typed text never reached the file'
    ).toBe(true);

    const history = saved()!.history as ChangeObj[];
    expect(history[0]).toMatchObject({
      inserted: '',
      front: 0,
      end: 0,
      pos: 0,
    });
    expect(reconstructHTML('', history, 0)).toBe('');
    expect(reconstructHTML('', history, 1)).toContain(TYPED[0]);
    expect(reconstructHTML('', history, history.length - 1)).toContain(TYPED);
  } finally {
    await app.close();
  }
});
