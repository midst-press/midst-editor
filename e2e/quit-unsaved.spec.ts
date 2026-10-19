import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst, parseMidst } from './fixtures';
import { launch, openDocument, SETTLE_MS } from './harness';

// Quitting straight after typing (#236, Annelyse's GitHub #74): Midst closed without asking and the last keystrokes
// were lost, with or without Save just before. Quit and Save are menu items run in the main process at once, while
// a keystroke reaches the editor first and the main process hears about it later. So the keys and the menu items
// are sent here the way the OS sends them, from the main process in one go: the keys queued for the window, then
// the items run. Before the fix both tests below failed every time. Invented text only.

const TYPED = 'ZQX';

// The dialog answers Cancel, so a window that asks stays open and the test can look at it.
async function answerCancel(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { asked: string[] };
    g.asked = [];
    dialog.showMessageBoxSync = ((_w: unknown, o: { message?: string }) => {
      g.asked.push(o?.message ?? '');
      return 1;
    }) as typeof dialog.showMessageBoxSync;
  });
}

async function typeThenRun(app: ElectronApplication, save: boolean) {
  await app.evaluate(
    ({ BrowserWindow, Menu, app: electronApp }, [text, alsoSave]) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      Array.from(text as string).forEach((c) => {
        wc.sendInputEvent({ type: 'keyDown', keyCode: c });
        wc.sendInputEvent({ type: 'char', keyCode: c });
        wc.sendInputEvent({ type: 'keyUp', keyCode: c });
      });
      if (alsoSave) {
        // Fails loudly if the id is ever renamed (#244 was a rename that silently clicked nothing).
        const saveItem =
          Menu.getApplicationMenu()?.getMenuItemById('menu.file.save');
        if (!saveItem) throw new Error('no menu.file.save item');
        saveItem.click();
      }
      // What Midst > Quit Midst does (menu.ts).
      electronApp.quit();
    },
    [TYPED, save] as const
  );
}

[false, true].forEach((save) => {
  test(`quitting straight after typing${
    save ? ' and Save' : ''
  }: the keystrokes are kept, or Midst asks`, async () => {
    const work = mkdtempSync(join(tmpdir(), 'midst-e2e-quit-'));
    const p = join(work, 'quit.midst');
    writeFileSync(p, makeMidst('QQSENT', 5).file);
    const { app, userData } = await launch(work);
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await openDocument(app, userData, p, 'the poem');
      const pm = win.locator('.ProseMirror');
      await expect(pm).toBeVisible({ timeout: 25_000 });
      await win.waitForTimeout(SETTLE_MS);
      await pm.click();
      await win.keyboard.press('End');
      await answerCancel(app);
      // CONTROL: nothing typed yet, so the file does not have the text.
      expect(parseMidst(readFileSync(p, 'utf8')).text).not.toContain(TYPED);

      await typeThenRun(app, save);

      // Kept or asked, never neither (as open-after-save.spec.ts holds for leaving after Save). Asked: Cancel kept
      // the window, with the keys in it. Not asked: the window closed, and only if the keys were saved, which is
      // what Save does when the editor has them before its request. Before the fix Midst closed without asking
      // and the file did not have them, in every run.
      const outcome = async () =>
        app
          .evaluate(
            () => (globalThis as unknown as { asked: string[] }).asked.length
          )
          .then((n) => (n > 0 ? 'asked' : 'pending'))
          .catch(() => 'closed');
      await expect
        .poll(outcome, {
          message: 'Midst neither asked nor closed',
          timeout: 10_000,
        })
        .not.toBe('pending');
      if ((await outcome()) === 'asked') {
        // CONTROL: the keys reached the editor, so the warning was about real keystrokes.
        await expect(pm).toContainText(TYPED);
      } else {
        expect(
          parseMidst(readFileSync(p, 'utf8')).text,
          'Midst closed without asking, and the keystrokes are not in the file'
        ).toContain(TYPED);
      }
    } finally {
      // Quit Anyway from here on, so closing the app does not stop at the dialog.
      await app
        .evaluate(({ dialog }) => {
          dialog.showMessageBoxSync = (() =>
            0) as typeof dialog.showMessageBoxSync;
        })
        .catch(() => undefined);
      await app.close();
    }
  });
});
