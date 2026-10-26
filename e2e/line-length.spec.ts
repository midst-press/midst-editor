import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import { launch, openDocument } from './harness';

// The writing column (#312; Annelyse, GitHub #84, "Use proposed"): about 15% of the window as a margin on each side,
// never less than 32px, and no character limit. The Timeline wraps a poem where the editor does, so both columns are
// measured. Invented text only.

// Where the text can go in an element: its box less its padding, as fractions of the window's width.
async function column(win: Page, selector: string) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const w = window.innerWidth;
    return {
      width: w,
      left: r.left + parseFloat(cs.paddingLeft),
      right: w - (r.right - parseFloat(cs.paddingRight)),
      overflow: document.documentElement.scrollWidth - w,
    };
  }, selector);
}

const expectMargins = (
  c: Awaited<ReturnType<typeof column>>,
  where: string
) => {
  const want = Math.max(0.15 * c.width, 32);
  // eslint-disable-next-line no-console -- the measurement is the report
  console.log(`line length [${where}]: ${JSON.stringify(c)}`);
  // Within a scrollbar's width: the editor's own scroller sits inside its right margin.
  expect(Math.abs(c.left - want), `${where}: left margin`).toBeLessThan(2);
  expect(Math.abs(c.right - want), `${where}: right margin`).toBeLessThan(20);
  expect(c.overflow, `${where}: nothing runs off the side`).toBeLessThanOrEqual(
    0
  );
};

[
  { width: 1600, height: 900 },
  { width: 600, height: 700 },
].forEach((size) => {
  test(`the writing column keeps about 15% each side, at least 32px (${size.width}px window)`, async () => {
    const work = mkdtempSync(join(tmpdir(), 'midst-e2e-column-'));
    const p = join(work, 'column.midst');
    writeFileSync(p, makeMidst('COLUMNSENT', 20).file);
    const { app, userData } = await launch(work);
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await app.evaluate(({ BrowserWindow }, s) => {
        BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height);
      }, size);
      await openDocument(app, userData, p, 'the poem');
      await expect(win.locator('.ProseMirror')).toBeVisible({
        timeout: 25_000,
      });
      await expect
        .poll(() => win.evaluate(() => window.innerWidth))
        .toBe(size.width);
      expectMargins(await column(win, '.ProseMirror'), `editor ${size.width}`);

      await win.getByRole('link', { name: 'Timeline' }).click();
      await expect(win.locator('.HistoryDisplay')).toBeVisible({
        timeout: 25_000,
      });
      expectMargins(
        await column(win, '.HistoryDisplay'),
        `timeline ${size.width}`
      );
    } finally {
      await app.close();
    }
  });
});
