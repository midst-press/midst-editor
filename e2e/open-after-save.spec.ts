import { test, expect, ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import { clickMenuItem, dialogsSeen, launch, openDocument } from './harness';

// #113. Type, choose File > Save, type again, and then, within the second, leave the poem: open another
// file, or close the window. The typing after Save must be kept in the file, or the poet asked before it
// is dropped. Never dropped without a word. Nonsense strings throughout. No poem content belongs in this
// repository.
/* eslint-disable no-unused-vars -- the names say what each argument is */
type Leave = (
  app: ElectronApplication,
  pathB: string,
  userData: string
) => Promise<void>;
/* eslint-enable no-unused-vars */

const leaveAfterSave = async (leave: Leave) => {
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
    await clickMenuItem(app, 'menu.file.save');
    await win.keyboard.type('QQB');
    expect(await pm.innerText()).toContain('QQB');
    const before = (await dialogsSeen(app)).length;
    await leave(app, pathB, userData);
    // The app may have quit with the window (closing a saved poem); then it showed no dialog.
    const prompted = (await dialogsSeen(app).catch(() => [])).length > before;

    // Past the autosave, so whatever it would write is on the disk.
    await new Promise((resolve) => {
      setTimeout(resolve, 2_500);
    });
    const savedA = readFileSync(pathA, 'utf8');
    // CONTROL: the Save itself worked.
    expect(savedA).toContain('QQA');
    expect(
      { keptInFile: savedA.includes('QQB'), prompted },
      'QQB was dropped without a prompt'
    ).not.toEqual({ keptInFile: false, prompted: false });
  } finally {
    await app.close();
  }
};

test('keystrokes typed after Save and before an open are either kept or asked about', async () => {
  await leaveAfterSave((app, pathB, userData) =>
    openDocument(app, userData, pathB, 'poem B')
  );
});

// Silas, review of #190: closing reads the same mark. Since #236 it asks the editor first and decides when the
// editor answers, so this waits for the decision: a dialog, or the window gone.
test('keystrokes typed after Save and before the window closes are either kept or asked about', async () => {
  await leaveAfterSave(async (app) => {
    // Cancel, recorded where dialogsSeen reads: a window that asks stays open, so the outcome can be read.
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { capturedDialogs: string[] };
      dialog.showMessageBoxSync = ((_w: unknown, o: { message?: string }) => {
        g.capturedDialogs.push(o?.message ?? '(no message)');
        return 1;
      }) as typeof dialog.showMessageBoxSync;
    });
    const before = (await dialogsSeen(app)).length;
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    // The app quits when the window goes, and then cannot be asked: that is "closed".
    await expect
      .poll(
        () =>
          dialogsSeen(app).then(
            (seen) => (seen.length > before ? 'asked' : 'pending'),
            () => 'closed'
          ),
        { message: 'the close was never decided', timeout: 10_000 }
      )
      .not.toBe('pending');
  });
});
