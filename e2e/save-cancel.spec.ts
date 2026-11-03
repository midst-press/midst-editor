import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SETTLE_MS, clickMenuItem, launch, readStore } from './harness';

// GitHub #106 (editor #392), CRITICAL: in a new poem, Save then Cancel in the save dialog took the poet to Home, and
// the poem could not be reached again. Cancelling the dialog must leave the poem open, as it was.
test('cancelling the first save of a new poem leaves the poem open', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-save-cancel-'));
  const TYPED = 'zq';

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    // The poet's Cancel: the save dialog answers with no file.
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialogSync = (() =>
        undefined) as unknown as typeof dialog.showSaveDialogSync;
    });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.emit('new-file', {});
    });

    const pm = win.locator('.ProseMirror');
    await expect(pm).toBeVisible({ timeout: 25_000 });
    await pm.click();
    await win.keyboard.type(TYPED, { delay: 60 });
    // CONTROL: the keystrokes reached the editor, so a missing poem below is not a typing failure.
    expect(await pm.innerText()).toContain(TYPED);

    await clickMenuItem(app, 'menu.file.save');
    await win.waitForTimeout(SETTLE_MS);

    // The poem is still on screen, with what was typed, and still untitled.
    await expect(pm).toBeVisible();
    expect(await pm.innerText()).toContain(TYPED);
    expect(readStore(userData).filename ?? '').toBe('');
  } finally {
    await app.close();
  }
});
