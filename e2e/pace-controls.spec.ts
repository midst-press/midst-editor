import { test, expect, Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makePlayableMidst } from './fixtures';
import { launch, openDocument, readStore } from './harness';

// The Timeline's frame rate and scroll speed (Annelyse, GitHub #49; editor #427), through the real controls:
// each opens on a click and stays open, the frame rate is the rate playback runs at, and both are kept when
// the app is opened again. Invented text only.

const SENTENCE =
  'zq xv a long invented line that goes on and on so that playback has many frames to step through, '.repeat(
    4
  );

const thumb = (win: Page) => win.locator('.MuiSlider-thumb input');

// Frames played in `ms` from the first frame, then paused.
const framesIn = async (win: Page, ms: number) => {
  await thumb(win).press('Home');
  await expect(thumb(win)).toHaveValue('0');
  await win.locator('[data-testid="PlayArrowIcon"]').click();
  await win.waitForTimeout(ms);
  await win.locator('[data-testid="PauseIcon"]').click();
  return Number(await thumb(win).inputValue());
};

// Open a pace control with a mouse click, as a poet does, and set its slider.
const setPace = async (win: Page, label: string, value: string) => {
  await win.getByRole('button', { name: label }).click();
  const slider = win.locator('.pace-popup input[type="range"]');
  await expect(
    slider,
    `the ${label} slider did not stay open after a click`
  ).toBeVisible();
  await slider.fill(value);
  return win.locator('.pace-popup output.pace-value');
};

const openTimeline = async (
  app: Awaited<ReturnType<typeof launch>>['app'],
  userData: string,
  poemPath: string
) => {
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await openDocument(app, userData, poemPath, 'the poem');
  await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
  await win.getByRole('link', { name: 'Timeline' }).click();
  await expect(win.locator('.ReplayContainer')).toBeVisible();
  return win;
};

test('the frame rate sets the playback pace, and both pace settings are kept', async () => {
  const doc = makePlayableMidst(SENTENCE);
  const work = mkdtempSync(join(tmpdir(), 'midst-pace-'));
  const poemPath = join(work, 'pace.midst');
  writeFileSync(poemPath, doc.file);

  const first = await launch(work);
  try {
    const win = await openTimeline(first.app, first.userData, poemPath);
    // 1. The default pace, one frame every 60ms: about 33 frames in two seconds.
    const atDefault = await framesIn(win, 2000);
    expect(
      atDefault,
      'playback did not run at the default pace'
    ).toBeGreaterThan(10);

    // 2. The frame rate at 60 fps plays faster.
    const fps = await setPace(win, 'Frame rate', '60');
    await expect(fps).toHaveText('60 fps');
    await win.keyboard.press('Escape');
    const atSixty = await framesIn(win, 2000);
    expect(
      atSixty,
      `60 fps played ${atSixty} frames, the default ${atDefault}`
    ).toBeGreaterThan(atDefault * 2);

    // 3. The scroll speed.
    const speed = await setPace(win, 'Scroll speed', '12.5');
    await expect(speed).toHaveText('12.5 views/s');
    await win.keyboard.press('Escape');
  } finally {
    await first.app.close();
  }
  expect(readStore(first.userData)['replay-fps']).toBe('60');
  expect(readStore(first.userData)['replay-scroll-speed']).toBe('12.5');

  // 4. Opened again, without seeding the store, both are where they were left.
  const again = await launch(work, { seed: false });
  try {
    const win = await openTimeline(again.app, again.userData, poemPath);
    await win.getByRole('button', { name: 'Frame rate' }).click();
    await expect(win.locator('.pace-popup output.pace-value')).toHaveText(
      '60 fps'
    );
    await win.keyboard.press('Escape');
    await win.getByRole('button', { name: 'Scroll speed' }).click();
    await expect(win.locator('.pace-popup output.pace-value')).toHaveText(
      '12.5 views/s'
    );
  } finally {
    await again.app.close();
  }
});
