import { test, expect } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import { waitUntil, launch, openDocument } from './harness';

// #157: File > Export as RTF… (like Save and Save As) reads the poem from the store, which the editor
// writes only when its autosave fires a second after the last keystroke. The menu now asks the editor
// for the poem first. Export is the action to test it with because the autosave never writes the RTF:
// what is in that file came through the menu's request, or not at all.
//
// Nonsense strings throughout. No poem content belongs in this repository.
const TYPED = 'ZZQXV';

test('Export as RTF… straight after typing exports the last keystrokes', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-flush-'));
  const doc = makeMidst('POEM-FLUSH-SENTINEL', 5);
  const poemPath = join(work, 'flush.midst');
  const rtfPath = join(work, 'flush.rtf');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem');
    const pm = win.locator('.ProseMirror');
    await expect(pm).toBeVisible({ timeout: 25_000 });
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialogSync = (() => p) as typeof dialog.showSaveDialogSync;
    }, rtfPath);

    await pm.click();
    await win.keyboard.press('End');
    await win.keyboard.type(TYPED);
    // CONTROL: the editor received every character.
    expect(await pm.innerText()).toContain(TYPED);

    // Well inside the autosave's second.
    const started = Date.now();
    await app.evaluate(({ Menu }) => {
      type Item = Electron.MenuItem;
      const find = (items: Item[]): Item | undefined => {
        const here = items.find((i) => i.label === 'Export as RTF…');
        if (here) return here;
        return items
          .map((i) => (i.submenu ? find(i.submenu.items) : undefined))
          .find(Boolean);
      };
      const item = find(Menu.getApplicationMenu()?.items ?? []);
      if (!item) throw new Error('no Export as RTF… item');
      item.click();
    });
    expect(
      await waitUntil(() => existsSync(rtfPath), 4_000),
      'no RTF was written'
    ).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(readFileSync(rtfPath, 'utf8')).toContain(TYPED);
  } finally {
    await app.close();
  }
});
