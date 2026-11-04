import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst, MIDST_VERSION_HEADER } from './fixtures';
import { clickMenuItem, launch, openDocument, waitUntil } from './harness';

// The text size belongs to the poem (editor #390; Annelyse, GitHub #105), the main road as a poet uses it
// (Cyril, 4 Nov): change it, quit, reopen. Invented text only.

const fileMeta = (path: string): { fontSize?: unknown } | undefined => {
  const raw = readFileSync(path, 'utf8');
  const json = raw.startsWith(MIDST_VERSION_HEADER)
    ? raw.slice(raw.indexOf('\n') + 1)
    : raw;
  return (JSON.parse(json) as { meta?: { fontSize?: unknown } }).meta;
};

// The size the poem is drawn at, as Chromium computed it.
const drawnSize = (win: Page) =>
  win.locator('.ProseMirror').evaluate((el) => getComputedStyle(el).fontSize);

test('a size changed on a poem is saved with it, and the poem reopens at it after a quit', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-size-'));
  const poem = join(work, 'sized.midst');
  // A poem saved by 0.9.4, with no size of its own.
  writeFileSync(poem, makeMidst('ZQSIZE', 0).file);
  const first = await launch(work);
  try {
    const win = await first.app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(first.app, first.userData, poem, 'the poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });

    // No size used yet: it opens at 16, where every poem was before, and nothing is written into it.
    await expect.poll(() => drawnSize(win)).toBe('16px');
    expect(fileMeta(poem)?.fontSize).toBeUndefined();

    const increase = win.getByRole('button', { name: 'Increase text size' });
    await increase.click();
    await increase.click();
    await expect.poll(() => drawnSize(win)).toBe('24px');
    expect(await waitUntil(() => fileMeta(poem)?.fontSize === 24, 10_000)).toBe(
      true
    );
  } finally {
    await first.app.close();
  }

  // Quit and reopen, keeping the store as the poet's would be.
  const second = await launch(work, { seed: false });
  try {
    const win = await second.app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(second.app, second.userData, poem, 'the poem again');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await expect.poll(() => drawnSize(win)).toBe('24px');

    // A second poem keeps its own size, whatever was used last.
    const other = join(work, 'other.midst');
    const doc = makeMidst('ZQOTHER', 0);
    const body = JSON.parse(doc.file.slice(doc.file.indexOf('\n') + 1));
    writeFileSync(
      other,
      `${MIDST_VERSION_HEADER}\n${JSON.stringify({ ...body, meta: { fontSize: 11 } })}`
    );
    await openDocument(second.app, second.userData, other, 'the other poem');
    await expect.poll(() => drawnSize(win)).toBe('11px');
  } finally {
    await second.app.close();
  }
});

test('a new poem starts at 14 when no size has been used', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-size-new-'));
  const { app } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await clickMenuItem(app, 'menu.file.new');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await expect.poll(() => drawnSize(win)).toBe('14px');
  } finally {
    await app.close();
  }
});
