import { test, expect } from '@playwright/test';
import type { ElectronApplication } from 'playwright';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch, readStore, shot } from './harness';

// Editor #265: the languages are on the opening screen with nothing to open (English with the American flag),
// and in View > Language. Only English has a catalog, so this pins that the controls are there, on screen and
// working, and keeps a screenshot of the opening screen for a person to look at.

const chooseFromMenu = (app: ElectronApplication, label: string) =>
  app.evaluate(({ Menu }, wanted) => {
    const menu = Menu.getApplicationMenu();
    const view = menu?.items.find((i) => i.label.replace('&', '') === 'View');
    const language = view?.submenu?.items.find((i) => i.label === 'Language');
    const item = language?.submenu?.items.find((i) => i.label === wanted);
    if (!item) throw new Error(`no View > Language > ${wanted}`);
    item.click();
  }, label);

test('the opening screen shows the languages, and both ways of choosing store the choice', async () => {
  const testInfo = test.info();
  const work = mkdtempSync(join(tmpdir(), 'midst-language-'));
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.message-container')).toBeVisible();

    const group = win.getByRole('group', { name: 'Language' });
    const english = group.getByRole('button', { name: 'English' });
    await expect(english).toBeVisible();
    await expect(english).toBeInViewport();
    await expect(english).toHaveAttribute('aria-pressed', 'true');
    await expect(english.locator('svg.language-flag')).toBeVisible();
    await expect(win.locator('html')).toHaveAttribute('lang', 'en');
    await shot(app, win, testInfo.outputPath('opening-screen-languages.png'));

    expect(readStore(userData).language).toBeUndefined();
    await english.click();
    await expect.poll(() => readStore(userData).language).toBe('en');

    await chooseFromMenu(app, 'English');
    await expect.poll(() => readStore(userData).language).toBe('en');
    await expect(english).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await app.close();
  }
});
