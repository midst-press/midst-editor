import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch } from './harness';

// Issue #80: every platform has an About that says which build is running. This opens it from the
// real application menu. The app under test runs from the built bundles and is not an installed
// package, so the line it shows is the development one; the released wording is covered by the unit
// tests of midst-format's build-label and of src/main/about.ts.

test('About Midst is in the menu, shows which build this is, and Copy copies it', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-'));
  const { app } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    const seen = await app.evaluate(async ({ Menu, dialog, clipboard }) => {
      const shown: { title?: string; detail?: string; buttons?: string[] }[] =
        [];
      const copied: string[] = [];
      // Answer with the second button, Copy, and keep what would have reached the clipboard.
      dialog.showMessageBox = (async (_w: unknown, opts: never) => {
        shown.push(opts);
        return { response: 1, checkboxChecked: false };
      }) as never;
      clipboard.writeText = ((text: string) => {
        copied.push(text);
      }) as never;

      const top = Menu.getApplicationMenu()!.items;
      const where = process.platform === 'darwin' ? 'Midst' : 'Help';
      const about = top
        .find((item) => item.label === where)
        ?.submenu?.items.find((item) => item.label === 'About Midst');
      if (!about) return { found: false, shown, copied };
      about.click();
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
      return { found: true, shown, copied };
    });

    expect(seen.found).toBe(true);
    expect(seen.shown).toHaveLength(1);
    expect(seen.shown[0].title).toBe('About Midst');
    // The version line, then the credits (src/main/about.ts CREDITS). Copy still copies the version line alone.
    expect(seen.shown[0].detail).toBe(
      [
        'Development build',
        '',
        'Director: Annelyse Gelman',
        '',
        'Developers:',
        'Stuart Swerdloff and the SJS Targeted Solutions Kindled team',
        'Juliet Shafto',
        'Jason Gillis-Grier',
      ].join('\n')
    );
    expect(seen.shown[0].buttons).toEqual(['OK', 'Copy', 'User Guide']);
    expect(seen.copied).toEqual(['Development build']);
  } finally {
    await app.close();
  }
});
