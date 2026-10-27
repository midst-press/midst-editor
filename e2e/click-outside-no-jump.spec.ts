import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import { launch, openDocument } from './harness';

// GitHub #92 (editor #334): in a long poem, a click outside the text (the header or footer, where the pointer is an
// arrow) made the poem jump to the caret. On a Mac the editor takes the focus back when it loses it, and that must
// not scroll. Elsewhere it does not take the focus back, so there is nothing to test.
test('a click in the footer of a long poem leaves the page where it was', async () => {
  test.skip(
    process.platform !== 'darwin',
    'the editor takes the focus back only on a Mac'
  );
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-no-jump-'));
  const poemPath = join(work, 'no-jump.midst');
  writeFileSync(poemPath, makeMidst('zq', 0).file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem');
    const pm = win.locator('.ProseMirror');
    await expect(pm).toBeVisible({ timeout: 25_000 });
    await pm.click();
    await win.keyboard.press('Meta+ArrowDown');
    for (let i = 0; i < 80; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await win.keyboard.press('Enter');
      // eslint-disable-next-line no-await-in-loop
      await win.keyboard.type(`line ${i}`);
    }
    // The caret at the top, the page at the bottom: a jump to the caret would show as the page going to the top.
    await win.keyboard.press('Meta+ArrowUp');
    const scrollTop = () => pm.evaluate((dom) => dom.scrollTop);
    await expect.poll(scrollTop, { timeout: 5_000 }).toBeLessThan(50);
    await pm.evaluate((dom) => {
      // eslint-disable-next-line no-param-reassign
      dom.scrollTop = dom.scrollHeight;
    });
    await expect.poll(scrollTop, { timeout: 5_000 }).toBeGreaterThan(200);
    const before = await scrollTop();

    // The empty left end of the footer, where the pointer is an arrow.
    await win.locator('.Spacer').click({ position: { x: 4, y: 4 } });
    // CONTROL: the click took the focus from the editor and the editor took it back, so the refocus happened.
    await expect
      .poll(() => pm.evaluate((dom) => document.activeElement === dom), {
        timeout: 5_000,
      })
      .toBe(true);
    // Give a scroll time to happen, then check none did.
    await win.waitForTimeout(500);
    expect(
      await scrollTop(),
      'the page jumped after the click'
    ).toBeGreaterThan(before - 50);
  } finally {
    await app.close();
  }
});
