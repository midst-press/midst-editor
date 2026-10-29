import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst, MIDST_VERSION_HEADER } from './fixtures';
import { clickMenuItem, launch, openDocument, waitUntil } from './harness';

// View > Font… (#240; Annelyse, GitHub #73): any installed font, one per poem, kept in the file. Invented
// text only.

const savedFontFamily = (path: string): unknown => {
  const raw = readFileSync(path, 'utf8');
  const json = raw.startsWith(MIDST_VERSION_HEADER)
    ? raw.slice(raw.indexOf('\n') + 1)
    : raw;
  return (JSON.parse(json) as { meta?: { fontFamily?: unknown } }).meta
    ?.fontFamily;
};

test("View > Font… lists the installed fonts, and the one chosen is the poem's, on screen and in the file", async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-font-'));
  const p = join(work, 'font.midst');
  writeFileSync(p, makeMidst('ZQFONT', 0).file);
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, p, 'the poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });

    await clickMenuItem(app, 'menu.view.font');
    const picker = win.getByRole('dialog', { name: 'Font for this poem' });
    await expect(picker).toBeVisible();
    // The app's own font, then at least one installed family.
    const options = picker.getByRole('option');
    await expect
      .poll(() => options.count(), { timeout: 15_000 })
      .toBeGreaterThan(1);
    const family = (await options.nth(1).textContent()) ?? '';
    expect(family).not.toBe('');

    await options.nth(1).click();
    await expect(picker).toBeHidden();
    // The first family of the computed value, unquoted: Chromium may or may not quote a name, so the
    // comparison is of names, not of how one is serialised.
    const first = await win.locator('.ProseMirror').evaluate((el) => {
      const value = getComputedStyle(el).fontFamily.trim();
      if (value.startsWith('"'))
        return value.slice(1, value.indexOf('"', 1)).replace(/\\(.)/g, '$1');
      return value.split(',')[0].trim();
    });
    expect(first).toBe(family);

    // The choice is saved into the poem's own file.
    expect(await waitUntil(() => savedFontFamily(p) === family, 10_000)).toBe(
      true
    );
  } finally {
    await app.close();
  }
});

test("in the poem's font, other alphabets still draw real characters, not the missing-glyph box", async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-font-scripts-'));
  const p = join(work, 'scripts.midst');
  writeFileSync(p, makeMidst('ZQSCRIPTS', 0).file);
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, p, 'the poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await clickMenuItem(app, 'menu.view.font');
    const options = win.getByRole('option');
    await expect
      .poll(() => options.count(), { timeout: 15_000 })
      .toBeGreaterThan(1);
    await options.nth(1).click();

    // Each character drawn in the poem's font stack, compared pixel for pixel with a code point no font has
    // (U+10FFFD, private use). A character that fell through to nothing draws the same box. This shows the
    // fallback happens; whether it looks good needs a person.
    const missing = await win.evaluate(() => {
      const stack = getComputedStyle(
        document.querySelector('.ProseMirror')!
      ).fontFamily;
      const draw = (ch: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext('2d')!;
        ctx.font = `32px ${stack}`;
        ctx.fillText(ch, 4, 36);
        return Array.from(ctx.getImageData(0, 0, 48, 48).data).join(',');
      };
      const box = draw(String.fromCodePoint(0x10fffd));
      const scripts: Record<string, string> = {
        greek: 'αβγδ',
        cyrillic: 'абвг',
        hebrew: 'אבגד',
        arabic: 'بتثج',
        devanagari: 'कखगघ',
        cjk: '日本語文',
      };
      return {
        // The control: another code point no font has must draw the same box, or this compares nothing.
        controlIsTheBox: draw(String.fromCodePoint(0x10fffc)) === box,
        scripts: Object.entries(scripts)
          .map(([name, chars]) => [
            name,
            Array.from(chars).filter((ch) => draw(ch) === box),
          ])
          .filter(([, same]) => (same as string[]).length > 0),
      };
    });
    expect(missing.controlIsTheBox).toBe(true);
    expect(missing.scripts).toEqual([]);
  } finally {
    await app.close();
  }
});
