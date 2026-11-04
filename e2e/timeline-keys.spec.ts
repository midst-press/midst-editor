import { test, expect, Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makePlayableMidst } from './fixtures';
import { launch, openDocument } from './harness';

// In Timeline mode Space only plays and pauses (#374, GitHub #98). A control clicked with the mouse keeps the
// focus, and Chromium clicks a focused button, or toggles a focused switch, when Space comes back up. Replay's own
// Space handler had already played or paused on the way down, so the two together undid each other on Play
// (GitHub #98, bug 2), turned Follow the writing over and drew its focus ring (bug 1), and turned Show timestamp
// over in Settings (bug 5).

const TEXT = 'the quick brown fox jumps over the lazy dog '.repeat(6).trim();

async function openTimeline(
  name: string
): Promise<{ win: Page; close: () => Promise<void>; failures: string[] }> {
  const doc = makePlayableMidst(TEXT);
  const work = mkdtempSync(join(tmpdir(), `midst-keys-${name}-`));
  const poemPath = join(work, 'keys.midst');
  writeFileSync(poemPath, doc.file);
  const { app, userData } = await launch(work);
  const failures: string[] = [];
  const win = await app.firstWindow();
  win.on('pageerror', (e) => failures.push(`pageerror: ${String(e)}`));
  win.on('console', (m) => {
    if (m.type() === 'error') failures.push(m.text());
  });
  await win.waitForLoadState('domcontentloaded');
  await openDocument(app, userData, poemPath, 'the keys poem');
  await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
  await win.getByRole('link', { name: 'Timeline' }).click();
  await expect(win.locator('.ReplayContainer')).toBeVisible({
    timeout: 25_000,
  });
  return { win, close: () => app.close(), failures };
}

const playButton = (win: Page) =>
  win.getByRole('button', { name: /^(Play|Pause)$/ });
const playing = async (win: Page) =>
  (await playButton(win).getAttribute('aria-label')) === 'Pause';
const focusRing = (win: Page) =>
  win.evaluate(() =>
    Boolean(document.activeElement?.matches(':focus-visible'))
  );

test('after Play is clicked with the mouse, Space pauses, and Space again plays', async () => {
  const { win, close, failures } = await openTimeline('play');
  try {
    await playButton(win).click();
    await expect(playButton(win)).toHaveAttribute('aria-label', 'Pause');
    expect(await focusRing(win), 'a mouse click drew a focus ring').toBe(false);
    await win.keyboard.press('Space');
    await expect(playButton(win)).toHaveAttribute('aria-label', 'Play');
    // GitHub #98 (2026-11-04): a ring on Play/Pause after a click and then Space.
    expect(await focusRing(win), 'Space after a click drew a focus ring').toBe(
      false
    );
    // Held for a moment, it is still one press: nothing toggles on the way back up.
    await win.waitForTimeout(300);
    expect(await playing(win), 'Space was undone when the key came up').toBe(
      false
    );
    await win.keyboard.press('Space');
    await expect(playButton(win)).toHaveAttribute('aria-label', 'Pause');
    expect(await focusRing(win), 'a second Space drew a focus ring').toBe(
      false
    );
    expect(failures).toEqual([]);
  } finally {
    await close();
  }
});

test('with Follow the writing clicked, Space plays and leaves Follow as it was, with no focus ring', async () => {
  const { win, close, failures } = await openTimeline('follow');
  try {
    const follow = win.getByRole('button', { name: 'Follow the writing' });
    await follow.click();
    const pressed = await follow.getAttribute('aria-pressed');
    expect(await focusRing(win), 'a mouse click drew a focus ring').toBe(false);
    await win.keyboard.press('Space');
    await expect(playButton(win)).toHaveAttribute('aria-label', 'Pause');
    await win.waitForTimeout(300);
    expect(
      await follow.getAttribute('aria-pressed'),
      'Space turned Follow the writing over'
    ).toBe(pressed);
    expect(await focusRing(win), 'Space drew a focus ring').toBe(false);
    expect(failures).toEqual([]);
  } finally {
    await close();
  }
});

test('with Show timestamp clicked in Settings, Space plays and leaves the switch as it was', async () => {
  const { win, close, failures } = await openTimeline('timestamp');
  try {
    await win.getByRole('button', { name: 'Settings' }).click();
    const timestamp = win.getByLabel('Show timestamp');
    await timestamp.click();
    const checked = await timestamp.isChecked();
    await win.keyboard.press('Space');
    await expect(playButton(win)).toHaveAttribute('aria-label', 'Pause');
    await win.waitForTimeout(300);
    expect(
      await timestamp.isChecked(),
      'Space turned Show timestamp over'
    ).toBe(checked);
    expect(failures).toEqual([]);
  } finally {
    await close();
  }
});

test('from the keyboard, Enter on a focused control works it, keeps the focus ring, and does not play', async () => {
  // GitHub #98 asked whether to remove the accessibility features. They stay: Tab reaches the controls and Enter
  // works them, with the ring showing where the focus is.
  const { win, close, failures } = await openTimeline('enter');
  try {
    const follow = win.getByRole('button', { name: 'Follow the writing' });
    await follow.focus();
    const pressed = await follow.getAttribute('aria-pressed');
    await win.keyboard.press('Enter');
    await expect(follow).not.toHaveAttribute('aria-pressed', pressed ?? '');
    await expect(follow).toBeFocused();
    expect(await focusRing(win), 'a keyboard user lost the focus ring').toBe(
      true
    );
    expect(await playing(win), 'Enter on a control also played the poem').toBe(
      false
    );
    expect(failures).toEqual([]);
  } finally {
    await close();
  }
});

test('a switch reached with Tab turns over on Space, keeps its ring, and does not play', async () => {
  // cora-2f1e43dc, review of 36eb9b5: a native switch toggles on Space and ignores Enter, so Space must reach it.
  const { win, close, failures } = await openTimeline('tab-switch');
  try {
    await win.getByRole('button', { name: 'Settings' }).click();
    const timestamp = win.getByLabel('Show timestamp');
    await expect(timestamp).toBeVisible();
    const onSwitch = () =>
      win.evaluate(
        () =>
          (document.activeElement as HTMLElement | null)?.closest(
            '.ShowTimestamp'
          ) !== null
      );
    // One Tab at a time, until the focus reaches the switch.
    const tabToSwitch = async (left: number): Promise<void> => {
      if (left === 0 || (await onSwitch())) return;
      await win.keyboard.press('Tab');
      await tabToSwitch(left - 1);
    };
    await tabToSwitch(40);
    expect(await onSwitch(), 'Tab never reached Show timestamp').toBe(true);
    const checked = await timestamp.isChecked();
    await win.keyboard.press('Space');
    await expect(timestamp).toBeChecked({ checked: !checked });
    expect(await focusRing(win), 'a keyboard user lost the focus ring').toBe(
      true
    );
    expect(await playing(win), 'Space on the switch also played').toBe(false);
    expect(failures).toEqual([]);
  } finally {
    await close();
  }
});
