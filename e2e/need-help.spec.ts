import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BETA_HELP_URL, helpUrl } from '../src/shared/helpUrl';
import { launch } from './harness';

// GitHub #63, issue #105: "Need Help?" on the opening screen opens the help on the Midst website
// in the poet's browser: the beta site for a beta of the app, the public one from 1.0.0. The main
// process opens it with shell.openExternal; this records that call instead of opening a browser.
// Which versions go where is covered by src/__tests__/helpUrl.test.ts; this is the wiring.

test('Need Help? on the opening screen opens the help for this version of the app', async () => {
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

    const version = await app.evaluate(({ app: electronApp }) =>
      electronApp.getVersion()
    );
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { opened?: string[] }).opened)
      )
      .toEqual([helpUrl(version)]);
    // The app under test is 0.x, so that is the beta site.
    expect(version).toMatch(/^0\./);
    expect(helpUrl(version)).toBe(BETA_HELP_URL);
    // The app itself stays on the opening screen.
    await expect(win.getByText('Welcome to Midst!')).toBeVisible();
  } finally {
    await app.close();
  }
});
