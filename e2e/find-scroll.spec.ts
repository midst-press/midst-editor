import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import { launch, openDocument } from './harness';

// Find scrolls the poem to the match it selects (#335; Annelyse, GitHub #93). Invented text only.

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// Every element that scrolls, with its scroll position, and where the selected match is on screen.
async function where(win: Page) {
  return win.evaluate(() => {
    const scrollers = [
      document.scrollingElement,
      ...document.querySelectorAll('*'),
    ]
      .filter(
        (el): el is Element => !!el && el.scrollHeight > el.clientHeight + 1
      )
      .map((el) => ({
        el: (el as HTMLElement).className || el.tagName,
        top: el.scrollTop,
        can: getComputedStyle(el).overflowY,
      }));
    const sel = window.getSelection();
    const rect =
      sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const mark = document.querySelector(
      '.search-current, .search-match-current, [data-search-current]'
    );
    const markRect = mark ? mark.getBoundingClientRect() : null;
    return {
      scrollers,
      selTop: rect?.top ?? null,
      markTop: markRect?.top ?? null,
      innerHeight: window.innerHeight,
    };
  });
}

test('Find scrolls to a match below the visible part of the poem', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-find-'));
  const p = join(work, 'find.midst');
  writeFileSync(p, makeMidst('ZQSTART', 0).file);
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(900, 600)
    );
    await openDocument(app, userData, p, 'the poem');
    const pm = win.locator('.ProseMirror');
    await expect(pm).toBeVisible({ timeout: 25_000 });
    await pm.click();
    await win.keyboard.press(`${MOD}+End`);
    // Eighty lines below the first, typed in one call: a poem taller than the window.
    await win.keyboard.type(
      Array.from(
        { length: 80 },
        (_, i) => `
line ${i}`
      ).join('')
    );
    await win.keyboard.type(' qvkeyword');
    await win.keyboard.press(`${MOD}+Home`);
    await win.evaluate(() => {
      [document.scrollingElement, ...document.querySelectorAll('*')].forEach(
        (el) => {
          if (el) el.scrollTop = 0;
        }
      );
    });
    const before = await where(win);
    // eslint-disable-next-line no-console -- the measurement is the report
    console.log(`find-scroll before: ${JSON.stringify(before)}`);
    await win.keyboard.press(`${MOD}+f`);
    const field = win.getByRole('textbox', { name: 'Find in the poem' });
    await expect(field).toBeVisible();
    await field.fill('qvkeyword');
    await win.waitForTimeout(500);
    const after = await where(win);
    // eslint-disable-next-line no-console -- the measurement is the report
    console.log(`find-scroll after: ${JSON.stringify(after)}`);
    expect(after.selTop, 'the match is on screen').not.toBeNull();
    expect(after.selTop as number).toBeGreaterThanOrEqual(0);
    expect(after.selTop as number).toBeLessThan(after.innerHeight);
  } finally {
    await app.close();
  }
});
