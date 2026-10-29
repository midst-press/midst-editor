import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reconstructHTML } from '@midst-press/midst-format/history';
import { makePlayableMidst } from './fixtures';
import { launch, openDocument } from './harness';

// Does a poem still PLAY?
//
// The open-sequence spec asserts the editor mounts and that files are not overwritten. Neither says
// anything about the timeline advancing, which is the one thing a reader of Midst comes for. Nothing
// covered it until this, and app playback had never been driven under test at all.
//
// It also guards a specific way to break it: adding `editor?.commands` to a Replay effect -- which
// react-hooks/exhaustive-deps asks for -- killed this view with React error #185, Maximum update
// depth exceeded, because `commands` is a getter returning a fresh object every access. The lint
// count went DOWN and the player died. Only assertion 3 below sees that.

const SENTENCE = 'the quick brown fox jumps over the lazy dog';

test('a poem plays back, advancing through its timeline', async () => {
  const doc = makePlayableMidst(SENTENCE);

  // CONTROL, before any Electron process exists: the fixture must reconstruct to its own final
  // state through the application's own `step` logic. If this fails, the FIXTURE is wrong and the
  // app is not implicated -- which is exactly what an earlier hand-built fixture did, rendering
  // frame zero forever and making working playback look broken.
  expect(
    reconstructHTML('', doc.history, doc.history.length - 1),
    'the generated fixture does not reconstruct; the fixture is wrong, not the app'
  ).toBe(doc.finalHtml);
  expect(
    doc.history.length,
    'need enough frames to observe advancing'
  ).toBeGreaterThan(20);

  const work = mkdtempSync(join(tmpdir(), 'midst-playback-'));
  const poemPath = join(work, 'playable.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  const failures: string[] = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => {
      failures.push(`pageerror: ${String(e)}`);
    });
    win.on('console', (m) => {
      if (m.type() === 'error') failures.push(m.text());
    });
    await win.waitForLoadState('domcontentloaded');

    await openDocument(app, userData, poemPath, 'the playable poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });

    await win.getByRole('link', { name: 'Timeline' }).click();
    await expect(
      win.locator('.ReplayContainer'),
      'the replay view did not render'
    ).toBeVisible({ timeout: 25_000 });

    const editor = win.locator('.ProseMirror').first();
    await expect(editor).toBeVisible({ timeout: 25_000 });

    // Sample from INSIDE the page, so no await sits in a loop out here. The element is requeried
    // each tick because React replaces it as the content changes.
    await win.evaluate(() => {
      const g = globalThis as unknown as {
        playbackLengths?: number[];
        playbackTimer?: ReturnType<typeof setInterval>;
      };
      g.playbackLengths = [];
      g.playbackTimer = setInterval(() => {
        const el = document.querySelector('.ProseMirror');
        g.playbackLengths!.push(el?.textContent?.length ?? -1);
      }, 120);
    });

    await win.locator('[data-testid="PlayArrowIcon"]').first().click();

    // 1. It REACHES THE END. The assertion that matters to a reader.
    await expect(
      editor,
      'playback never reached the end of the poem'
    ).toContainText(SENTENCE, { timeout: 60_000 });

    const lengths = await win.evaluate(() => {
      const g = globalThis as unknown as {
        playbackLengths?: number[];
        playbackTimer?: ReturnType<typeof setInterval>;
      };
      if (g.playbackTimer) clearInterval(g.playbackTimer);
      return g.playbackLengths ?? [];
    });

    // 2. It ADVANCED THROUGH the timeline rather than jumping. A player that rendered only the
    //    final frame would satisfy assertion 1 and fail this one, which is what makes 1 mean
    //    something.
    const distinct = new Set(lengths.filter((n) => n >= 0));
    expect(
      distinct.size,
      `expected several intermediate states; saw lengths ${[...distinct].join(
        ','
      )}`
    ).toBeGreaterThan(2);

    // 3. Nothing threw. This is the arm that catches an effect-dependency loop.
    expect(
      failures,
      `the page reported errors:\n${failures.join('\n')}`
    ).toEqual([]);
  } finally {
    await app.close();
  }
});

test('pausing playback stops it, and it stays stopped', async () => {
  // The pause path clears the playback timer. Nothing covered it, and the timer handle moved from
  // useState to useRef -- `playingInterval` is never rendered, only created, cleared and tested, and
  // holding it in state forced it into the dependency array of the effect that registers Replay's
  // IPC listeners, which would then re-register on every play and pause.
  const doc = makePlayableMidst(SENTENCE);
  const work = mkdtempSync(join(tmpdir(), 'midst-pause-'));
  const poemPath = join(work, 'pausable.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  const failures: string[] = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => {
      failures.push(`pageerror: ${String(e)}`);
    });
    win.on('console', (m) => {
      if (m.type() === 'error') failures.push(m.text());
    });
    await win.waitForLoadState('domcontentloaded');

    await openDocument(app, userData, poemPath, 'the pausable poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await win.getByRole('link', { name: 'Timeline' }).click();
    await expect(win.locator('.ReplayContainer')).toBeVisible({
      timeout: 25_000,
    });

    const len = () =>
      win.evaluate(
        () => document.querySelector('.ProseMirror')?.textContent?.length ?? -1
      );

    await win.locator('[data-testid="PlayArrowIcon"]').first().click();

    // Let it get under way, then stop it well before the end.
    await win.waitForFunction(
      () =>
        (document.querySelector('.ProseMirror')?.textContent?.length ?? 0) >= 8,
      null,
      { timeout: 30_000 }
    );
    await win.locator('[data-testid="PauseIcon"]').first().click();

    const atPause = await len();

    // CONTROL: we paused BEFORE the end. Without this, a run where playback had already finished
    // would show a frozen length and pass while testing nothing -- the length cannot change once
    // the poem is complete, pause or no pause.
    expect(
      atPause,
      'playback had already finished, so pausing proved nothing'
    ).toBeLessThan(doc.finalText.length);

    // The timer is cleared, so the content must not advance again.
    await win.waitForTimeout(900);
    expect(await len(), 'playback continued after pause').toBe(atPause);

    expect(
      failures,
      `the page reported errors:\n${failures.join('\n')}`
    ).toEqual([]);
  } finally {
    await app.close();
  }
});
