import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch } from './harness';

// GitHub #63: "Need Help?" on the opening screen opens the help on the Midst website in the
// poet's browser. The link opens a new window, which the main process hands to shell.openExternal
// (setWindowOpenHandler in main.ts); this records that call instead of opening a browser.

test('Need Help? on the opening screen opens the help on the Midst website', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-'));
  const { app } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as { opened?: string[] }).opened = opened;
      shell.openExternal = (async (url: string) => {
        opened.push(url);
      }) as never;
    });

    await win.getByText('Need Help?').click();

    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { opened?: string[] }).opened)
      )
      .toEqual(['https://www.midst.press/app#help']);
    // The app itself stays on the opening screen.
    await expect(win.getByText('Welcome to Midst!')).toBeVisible();
  } finally {
    await app.close();
  }
});
