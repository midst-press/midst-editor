import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import { dialogsSeen, launch, openDocument } from './harness';

// #113. Type, choose File > Save, type again, and open another file within the second. Nonsense strings
// throughout. No poem content belongs in this repository.
test('keystrokes typed after Save and before an open are either kept or asked about', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-open-after-save-'));
  const A = makeMidst('POEM-OAS-A-SENTINEL', 5);
  const B = makeMidst('POEM-OAS-B-SENTINEL', 5);
  const pathA = join(work, 'oas-a.midst');
  const pathB = join(work, 'oas-b.midst');
  writeFileSync(pathA, A.file);
  writeFileSync(pathB, B.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, pathA, 'poem A');
    const pm = win.locator('.ProseMirror');
    await expect(pm).toBeVisible({ timeout: 25_000 });

    await pm.click();
    await win.keyboard.press('End');
    await win.keyboard.type('QQA');
    await app.evaluate(async ({ Menu }) => {
      await Menu.getApplicationMenu()?.getMenuItemById('save')?.click();
    });
    await win.keyboard.type('QQB');
    expect(await pm.innerText()).toContain('QQB');
    const before = (await dialogsSeen(app)).length;
    await openDocument(app, userData, pathB, 'poem B');
    const prompted = (await dialogsSeen(app)).length > before;

    // Past the autosave, so whatever it would write is on the disk.
    await new Promise((resolve) => {
      setTimeout(resolve, 2_500);
    });
    const savedA = readFileSync(pathA, 'utf8');
    // Kept in A's file, or the poet was asked before it was dropped. Never dropped without a word.
    expect(
      { keptInFile: savedA.includes('QQB'), prompted },
      'QQB was dropped without a prompt'
    ).not.toEqual({ keptInFile: false, prompted: false });
  } finally {
    await app.close();
  }
});
