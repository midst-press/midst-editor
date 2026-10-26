import { test, expect, Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeJumpingMidst } from './fixtures';
import { launch, openDocument } from './harness';

// GitHub #24: back from Replay, the cursor is where the poet left it, and the poem is scrolled to show it.
// Replay unmounts the editor and the way back makes a new one, so this is checked in the running app, where
// the page has a layout to scroll; the unit tests (Editor.test.tsx) pin the selection. Invented text only.

type Where = {
  anchor: number;
  top: number;
  bottom: number;
  viewTop: number;
  viewBottom: number;
  scrollTop: number;
  scrolls: boolean;
};

// The cursor's position, where it is drawn, and the visible part of the box the poem scrolls in.
const where = (win: Page): Promise<Where> =>
  win.evaluate(() => {
    const { editor } = document.querySelector('.ProseMirror') as unknown as {
      editor: any;
    };
    const { anchor } = editor.state.selection;
    const caret = editor.view.coordsAtPos(anchor);
    let box: HTMLElement | null = editor.view.dom as HTMLElement;
    while (
      box &&
      !(
        box.scrollHeight > box.clientHeight &&
        /(auto|scroll)/.test(getComputedStyle(box).overflowY)
      )
    )
      box = box.parentElement;
    const view = (box ?? document.documentElement).getBoundingClientRect();
    return {
      anchor,
      top: caret.top,
      bottom: caret.bottom,
      viewTop: view.top,
      viewBottom: view.bottom,
      scrollTop: box ? box.scrollTop : -1,
      scrolls: box !== null,
    };
  });

test('back from Replay, the cursor is where it was, and in view', async () => {
  const doc = makeJumpingMidst('end');
  const dir = mkdtempSync(join(tmpdir(), 'midst-cursor-return-'));
  const poemPath = join(dir, 'jumping.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(dir);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });

    // The cursor most of the way down a poem taller than the window.
    const left = await win.evaluate(() => {
      const { editor } = document.querySelector('.ProseMirror') as unknown as {
        editor: any;
      };
      editor.commands.setTextSelection(
        Math.floor(editor.state.doc.content.size * 0.8)
      );
      return editor.state.selection.anchor as number;
    });

    await win.getByRole('button', { name: 'Timeline' }).click();
    await expect(win.locator('.ReplayContainer')).toBeVisible({
      timeout: 25_000,
    });
    await win.getByRole('button', { name: 'Edit' }).click();
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });

    // The cursor is back where it was (on main it is at the start, 1)...
    await expect
      .poll(async () => (await where(win)).anchor, { timeout: 10_000 })
      .toBe(left);
    // ...and drawn inside the visible part of the poem, which had to scroll to show it.
    await expect
      .poll(async () => (await where(win)).scrollTop, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const back = await where(win);
    expect(
      back.scrolls,
      'CONTROL: the poem is taller than its box, so the cursor needs a scroll'
    ).toBe(true);
    expect(
      back.top,
      'the cursor is above the visible part'
    ).toBeGreaterThanOrEqual(back.viewTop);
    expect(
      back.bottom,
      'the cursor is below the visible part'
    ).toBeLessThanOrEqual(back.viewBottom);
  } finally {
    await app.close();
  }
});
