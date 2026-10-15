import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch, readStore } from './harness';

// GitHub #16: View > Appearance switches the editor's interface between light and dark. This drives the
// real menu item in the main process, then reads the custom properties the renderer actually resolved at
// the root, and keeps a screenshot of the opening screen in each scheme for a person to look at. The
// profile is the harness's throwaway one, so no poem is ever on screen.

// Choose an item under View > Appearance, as the poet would, by clicking the built menu's own item.
const choose = (app: ElectronApplication, label: string) =>
  app.evaluate(({ Menu }, wanted) => {
    const menu = Menu.getApplicationMenu();
    const view = menu?.items.find((i) => i.label.replace('&', '') === 'View');
    const appearance = view?.submenu?.items.find(
      (i) => i.label === 'Appearance'
    );
    const item = appearance?.submenu?.items.find((i) => i.label === wanted);
    if (!item) throw new Error(`no View > Appearance > ${wanted}`);
    item.click();
  }, label);

const rootColours = (win: Page) =>
  win.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(name).trim();
    return {
      scheme: window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light',
      background: read('--midst-background'),
      // Resolved values, which do not depend on how the build minified the stylesheet.
      text: getComputedStyle(document.body).color,
      surface: read('--midst-surface'),
      body: getComputedStyle(document.body).backgroundColor,
      // The opening screen's buttons fade their background over 100ms, so this is read too: a
      // screenshot taken before it settles shows white text on the light button.
      button: (() => {
        const b = document.querySelector('.file-button-container button');
        if (!b) return null;
        const c = getComputedStyle(b);
        return `${c.color} on ${c.backgroundColor}`;
      })(),
    };
  });

test('View > Appearance switches the interface between light and dark', async () => {
  const testInfo = test.info();
  const work = mkdtempSync(join(tmpdir(), 'midst-appearance-'));
  const { app, userData } = await launch(work, { followAppearance: true });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.message-container')).toBeVisible();

    await choose(app, 'Light');
    await expect
      .poll(() => rootColours(win))
      .toEqual({
        scheme: 'light',
        background: '#fff5ee',
        text: 'rgba(0, 0, 0, 0.87)',
        surface: '#fff',
        body: 'rgb(255, 245, 238)',
        button: 'rgba(77, 77, 77, 0.9) on rgb(240, 240, 240)',
      });
    expect(readStore(userData).appearance).toBe('light');
    await win.screenshot({ path: testInfo.outputPath('appearance-light.png') });

    await choose(app, 'Dark');
    await expect
      .poll(() => rootColours(win))
      .toEqual({
        scheme: 'dark',
        background: '#1f1a1c',
        text: 'rgb(255, 255, 255)',
        surface: '#2b2427',
        body: 'rgb(31, 26, 28)',
        button: 'rgba(255, 255, 255, 0.87) on rgb(58, 50, 54)',
      });
    expect(readStore(userData).appearance).toBe('dark');
    await win.screenshot({ path: testInfo.outputPath('appearance-dark.png') });
  } finally {
    await app.close();
  }
});

test('the stored choice is in force when the app next opens', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-appearance-relaunch-'));
  const first = await launch(work, { followAppearance: true });
  try {
    await first.app.firstWindow();
    await choose(first.app, 'Dark');
  } finally {
    await first.app.close();
  }
  // The same profile, unseeded so the stored choice survives.
  const second = await launch(work, {
    seed: false,
    followAppearance: true,
  });
  try {
    const win = await second.app.firstWindow();
    await expect(win.locator('.message-container')).toBeVisible();
    expect(
      await second.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)
    ).toBe('dark');
    expect((await rootColours(win)).scheme).toBe('dark');
  } finally {
    await second.app.close();
  }
});
