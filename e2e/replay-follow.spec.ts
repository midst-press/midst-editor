import {
  test,
  expect,
  chromium,
  ElectronApplication,
  Page,
} from '@playwright/test';
import { mkdtempSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeJumpingMidst } from './fixtures';
import { launch, openDocument, readStore } from './harness';
import { reconstructHTML } from '../src/renderer/tracking/utils';

// Does Replay keep the WRITING on screen, and get there gently?
//
// Annelyse (midst-press/midst-web#32): "when the author jumps to a place that was off screen, the content
// should scroll gently to that new point rather than jump", so the reader keeps their place. Replay's
// scroll was `domAtPos(pos).node.scrollIntoView?.({ block: 'center' })`: instant, and for a caret inside
// text the node is a Text node with no scrollIntoView, so nothing moved at all (midst-editor #20).
//
// Measured from INSIDE the page every 20ms: where the text changed since the last sample (first differing
// character, as a DOM Range), whether that point is inside the visible area of the element that scrolls,
// and that element's scrollTop.
//   followed  a stretch of writing in one place that lasts over SETTLE_MS must end with it on screen
//   gentle    no 20ms tick may move the scroll by more than a third of the viewport
//
// Annelyse's own Autoscroll Test Poem is used when MIDST_AUTOSCROLL_POEM names it (poem files never live in
// this repository); otherwise that case is skipped.

// One sample per 20ms tick: the CURRENT target (where the text last changed), whether it is on screen NOW,
// the scroll position, the time, and whether the text changed on this tick. The target is re-measured on
// every tick, including quiet ones, so a last edit followed by stillness is still judged (alden-ec2221c7).
// clamped: the document got shorter and the browser pulled scrollTop to its new maximum. That is layout,
// not Replay scrolling, so the gentle and waits checks ignore it.
type Sample = [number, number, boolean, number, number, boolean, boolean]; // paragraph, char, visible, scrollTop, ms, changed, clamped
const SETTLE_MS = 500;

export type Rec = { samples: Sample[]; viewport: number };
async function record(win: Page, done: () => Promise<void>): Promise<Rec> {
  await win.evaluate(() => {
    const g = globalThis as unknown as {
      fs?: Sample[];
      ft?: ReturnType<typeof setInterval>;
      fv?: number;
    };
    const scroller = (el: HTMLElement | null) => {
      let s = el;
      while (
        s &&
        !(
          s.scrollHeight > s.clientHeight + 1 &&
          /(auto|scroll)/.test(getComputedStyle(s).overflowY)
        )
      )
        s = s.parentElement;
      return s;
    };
    g.fs = [];
    let last: string[] = [];
    let target: [number, number] | null = null;
    let lastHeight = 0;
    let lastTop = 0;
    const t0 = performance.now();
    g.ft = setInterval(() => {
      const pm = document.querySelector(
        '.ReplayContainer .ProseMirror'
      ) as HTMLElement | null;
      const s = scroller(pm);
      if (!pm || !s) return;
      g.fv = s.clientHeight;
      // A clamp only if the OLD position no longer fits the shorter document, and the new position is its
      // maximum. A shrink alongside a jump the shrink did not force is still a jump (alden-ec2221c7).
      const newMax = s.scrollHeight - s.clientHeight;
      const clamped =
        s.scrollHeight < lastHeight &&
        lastTop > newMax + 0.5 &&
        Math.abs(s.scrollTop - newMax) < 1;
      lastHeight = s.scrollHeight;
      lastTop = s.scrollTop;
      const ps = Array.from(pm.children) as HTMLElement[];
      const now = ps.map((p) => p.textContent ?? '');
      // First paragraph that differs, INCLUDING when the paragraph count changed (a line added or deleted):
      // otherwise a deletion leaves a stale target that reads as off screen.
      let k = -1;
      if (last.length) {
        for (let i = 0; i < Math.max(now.length, last.length); i += 1)
          if (now[i] !== last[i]) {
            k = Math.min(i, now.length - 1);
            break;
          }
      }
      const changed = k >= 0;
      if (changed) {
        const prev = last[k] ?? '';
        let c = 0;
        while (c < now[k].length && now[k][c] === prev[c]) c += 1;
        target = [k, c];
      }
      last = now;
      if (!target || !ps[target[0]]) return;
      const [tk, tc] = target;
      // A Range at character tc of paragraph tk: walk its text nodes.
      const walk = document.createTreeWalker(ps[tk], NodeFilter.SHOW_TEXT);
      let n = walk.nextNode() as Text | null;
      let left = tc;
      while (n && left > n.length) {
        left -= n.length;
        n = walk.nextNode() as Text | null;
      }
      const box = s.getBoundingClientRect();
      let r = ps[tk].getBoundingClientRect();
      if (n) {
        const range = document.createRange();
        range.setStart(n, Math.min(left, n.length));
        range.setEnd(n, Math.min(left, n.length));
        const rr = range.getBoundingClientRect();
        if (rr.height) r = rr;
      }
      g.fs!.push([
        tk,
        tc,
        r.top >= box.top && r.bottom <= box.bottom,
        s.scrollTop,
        performance.now() - t0,
        changed,
        clamped,
      ]);
    }, 20);
  });
  await done();
  return win.evaluate(() => {
    const g = globalThis as unknown as {
      fs?: Sample[];
      ft?: ReturnType<typeof setInterval>;
      fv?: number;
    };
    if (g.ft) clearInterval(g.ft);
    return { samples: g.fs ?? [], viewport: g.fv ?? 0 };
  });
}

// followed   A stretch is writing in one place (same paragraph, character moving by less than 40), lasting
//            until the next change elsewhere, quiet ticks included. One that lasts over SETTLE_MS must end
//            with its target on screen.
// gentle     No tick moves the scroll by more than a third of the viewport, AND every scroll movement of
//            more than 50px spans at least 3 moving ticks (an instant jump of any size is one tick).
// waits      The text never changes strictly inside a scroll movement (midst-editor #22).
export function verdict({ samples, viewport }: Rec) {
  const stretches: Sample[][] = [];
  samples.forEach((s) => {
    const cur = stretches[stretches.length - 1];
    const p = cur?.[cur.length - 1];
    if (p && p[0] === s[0] && Math.abs(p[1] - s[1]) < 40) cur.push(s);
    else stretches.push([s]);
  });
  const settled = stretches.filter(
    (st) => st[st.length - 1][4] - st[0][4] > SETTLE_MS
  );
  const unfollowed = settled.filter((st) => !st[st.length - 1][2]).length;
  if (process.env.FOLLOW_DEBUG)
    settled
      .filter((st) => !st[st.length - 1][2])
      .forEach((st) =>
        // eslint-disable-next-line no-console
        console.log(
          `unfollowed: para ${st[0][0]} char ${st[0][1]}..${
            st[st.length - 1][1]
          } from ${Math.round(st[0][4])}ms to ${Math.round(
            st[st.length - 1][4]
          )}ms of ${Math.round(samples[samples.length - 1][4])}ms; changes ${
            st.filter((x) => x[5]).length
          }; visible ticks ${st.filter((x) => x[2]).length}/${
            st.length
          }; scrollTop ${Math.round(st[0][3])}->${Math.round(
            st[st.length - 1][3]
          )}`
        )
      );
  const tops = samples.map((x) => x[3]);
  const moving = tops.map(
    (t, i) => i > 0 && !samples[i][6] && Math.abs(t - tops[i - 1]) > 0.5
  );
  let abrupt = 0;
  let instant = 0;
  let wroteWhileGliding = 0;
  const glideDetail: string[] = [];
  // Reported, not asserted: what the glides cost. Distances in viewports, durations in ms.
  let moves = 0;
  let maxMoveViewports = 0;
  let maxGlideMs = 0;
  let maxStepFraction = 0;
  for (let i = 1; i < tops.length; i += 1)
    if (moving[i]) {
      const step = Math.abs(tops[i] - tops[i - 1]);
      if (viewport > 0)
        maxStepFraction = Math.max(maxStepFraction, step / viewport);
      if (step > viewport / 3) abrupt += 1;
    }
  // Movements: maximal runs of moving ticks.
  let i = 1;
  while (i < tops.length) {
    if (!moving[i]) {
      i += 1;
    } else {
      let j = i;
      while (j + 1 < tops.length && moving[j + 1]) j += 1;
      const distance = Math.abs(tops[j] - tops[i - 1]);
      if (distance > 50 && j - i + 1 < 3) instant += 1;
      moves += 1;
      if (viewport > 0)
        maxMoveViewports = Math.max(maxMoveViewports, distance / viewport);
      maxGlideMs = Math.max(maxGlideMs, samples[j][4] - samples[i - 1][4]);
      // STRICTLY inside: the glide's last frame and the next step can share one 20ms sample, which is
      // ordering the sampler cannot resolve, not the playback moving on mid-glide.
      for (let m = i + 1; m < j; m += 1)
        if (samples[m][5]) {
          wroteWhileGliding += 1;
          glideDetail.push(
            `text changed at tick ${m - i + 1} of ${
              j - i + 1
            } (scroll ${Math.round(tops[i - 1])}->${Math.round(tops[j])})`
          );
        }
      i = j + 1;
    }
  }
  return {
    samples: samples.length,
    settled: settled.length,
    unfollowed,
    abrupt,
    instant,
    wroteWhileGliding,
    glideDetail,
    viewport,
    moves,
    maxMoveViewports: +maxMoveViewports.toFixed(2),
    maxGlideMs: Math.round(maxGlideMs),
    maxStepFraction: +maxStepFraction.toFixed(3),
  };
}

// Window sizes every follow case runs at. The helper is copied verbatim into the website's player,
// whose 720px-tall page leaves a much shorter scroller than the editor's default window, so the
// verdict must hold at both (alden-ec2221c7 found a step of 162px in a 439px view on the website).
const WINDOWS = [
  { name: 'default', size: null },
  { name: 'short', size: { width: 1280, height: 600 } },
] as const;

async function openReplay(
  poemPath: string,
  size: { width: number; height: number } | null = null,
  seed = true
): Promise<{ app: ElectronApplication; win: Page; userData: string }> {
  const { app, userData } = await launch(join(poemPath, '..'), { seed });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  if (size)
    await app.evaluate(({ BrowserWindow }, s) => {
      BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height);
    }, size);
  await openDocument(app, userData, poemPath, 'the poem');
  await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
  await win.getByRole('link', { name: 'Replay' }).click();
  await expect(win.locator('.ReplayContainer')).toBeVisible({
    timeout: 25_000,
  });
  return { app, win, userData };
}

function assertFollows(name: string, v: ReturnType<typeof verdict>) {
  // eslint-disable-next-line no-console -- the measurement is the report
  console.log(`replay follow [${name}]: ${JSON.stringify(v)}`);
  // CONTROLS: there was writing that stayed in one place long enough to judge, and the poem scrolls.
  expect(
    v.settled,
    'no stretch of writing long enough to judge'
  ).toBeGreaterThan(0);
  expect(
    v.viewport,
    'no scrolling container: the poem fits, so the test proves nothing'
  ).toBeGreaterThan(0);
  expect(v.unfollowed, 'stretches of writing that ended off screen').toBe(0);
  expect(
    v.abrupt,
    '20ms ticks where the scroll moved more than a third of the viewport'
  ).toBe(0);
  expect(
    v.instant,
    'scroll movements of over 50px completed in fewer than 3 ticks'
  ).toBe(0);
  expect(
    v.wroteWhileGliding,
    `text changed while the view was still moving: ${v.glideDetail.join('; ')}`
  ).toBe(0);
}

// The VERDICT can say no: hand-built recordings, one per way of failing, plus one that must pass.
// (alden-ec2221c7's counterexamples: a quiet last edit that never arrives, and an instant 200px jump.)
test('the follow verdict rejects each failure it claims to catch', () => {
  const tick = (
    i: number,
    k: number,
    visible: boolean,
    top: number,
    changed = false
  ): Sample => [k, 0, visible, top, i * 20, changed, false];
  const run = (
    n: number,
    from: number,
    k: number,
    visible: boolean,
    top: number | number[],
    changedAt: number[] = [0]
  ) =>
    Array.from({ length: n }, (_, j) =>
      tick(
        from + j,
        k,
        visible,
        typeof top === 'number' ? top : top[j],
        changedAt.includes(j)
      )
    );
  const viewport = 600;
  const good = verdict({ samples: run(50, 0, 1, true, 0), viewport });
  expect(good).toMatchObject({
    settled: 1,
    unfollowed: 0,
    abrupt: 0,
    instant: 0,
    wroteWhileGliding: 0,
  });
  // Visible writing, then ONE edit far away that never comes into view during 2.5s of stillness.
  const late = verdict({
    samples: [...run(30, 0, 1, true, 0), ...run(125, 30, 140, false, 0)],
    viewport,
  });
  expect(late.unfollowed).toBe(1);
  // A 200px jump in one tick: within the third-of-viewport limit, still not a glide.
  const jump = verdict({
    samples: [...run(30, 0, 1, true, 0), ...run(30, 30, 20, true, 200)],
    viewport,
  });
  expect(jump.abrupt).toBe(0);
  expect(jump.instant).toBe(1);
  // The same 200px change, made by the browser clamping a shrunken document, is layout, not a jump.
  const clamp = run(60, 0, 20, true, [
    ...Array(30).fill(0),
    ...Array(30).fill(200),
  ]);
  clamp[30][6] = true;
  expect(verdict({ samples: clamp, viewport }).instant).toBe(0);
  // A glide of 300px over 10 ticks passes; the same glide with the text changing mid-way does not wait.
  const glide = Array.from({ length: 40 }, (_, j) => Math.min(300, j * 30));
  expect(
    verdict({ samples: run(40, 0, 20, true, glide), viewport }).instant
  ).toBe(0);
  expect(
    verdict({ samples: run(40, 0, 20, true, glide, [0, 5]), viewport })
      .wroteWhileGliding
  ).toBe(1);
  // A step on the glide's last tick is ordering within one sample, not a failure to wait.
  expect(
    verdict({ samples: run(40, 0, 20, true, glide, [0, 10]), viewport })
      .wroteWhileGliding
  ).toBe(0);
});

// The RECORDER's clamp label, on a controlled page (alden-ec2221c7): a document that shrinks while the
// view jumps further than the shrink forced is a jump; a shrink that pulls an out-of-range position back
// to the new maximum is a clamp. 90 lines of 20px in a 600px scroller; 45 are then removed (max 300).
test('the recorder tells a forced clamp from a jump that rides along with a shrink', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const scenario = async (startTop: number, jumpTo: number | null) => {
      await page.setContent(
        `<div class="ReplayContainer" style="height:600px;overflow-y:auto"><div class="ProseMirror">${Array.from(
          { length: 90 },
          (_, i) => `<p style="margin:0;height:20px">line ${i}</p>`
        ).join('')}</div></div>`
      );
      await page.evaluate((t) => {
        (document.querySelector('.ReplayContainer') as HTMLElement).scrollTop =
          t;
      }, startTop);
      return verdict(
        await record(page, async () => {
          await page.waitForTimeout(100);
          // A visible edit near the current view, so there is a target.
          await page.evaluate((t) => {
            const ps = document.querySelectorAll('.ProseMirror p');
            ps[Math.floor(t / 20) + 2].textContent += 'x';
          }, startTop);
          await page.waitForTimeout(200);
          // Shrink to 45 lines and, in the same task, optionally set scrollTop.
          await page.evaluate((to) => {
            const ps = Array.from(document.querySelectorAll('.ProseMirror p'));
            ps.slice(45).forEach((x) => x.remove());
            if (to !== null)
              (
                document.querySelector('.ReplayContainer') as HTMLElement
              ).scrollTop = to;
          }, jumpTo);
          await page.waitForTimeout(200);
        })
      );
    };
    // From 0, nothing forced a move: the 0->300 jump must be reported.
    const riding = await scenario(0, 300);
    expect(riding.instant + riding.abrupt).toBeGreaterThan(0);
    // From 1200, the browser must pull back to 300: a clamp, not a jump.
    const forced = await scenario(1200, null);
    expect(forced).toMatchObject({ abrupt: 0, instant: 0 });
  } finally {
    await browser.close();
  }
});

WINDOWS.forEach((w) =>
  (['end', 'middle'] as const).forEach((at) => {
    test(`replay follows jumping writing, gently (typing at the ${at} of a line, ${w.name} window)`, async () => {
      const doc = makeJumpingMidst(at);
      // CONTROL: the fixture reconstructs through the app's own step logic.
      expect(reconstructHTML('', doc.history, doc.history.length - 1)).toBe(
        doc.finalHtml
      );
      const poemPath = join(
        mkdtempSync(join(tmpdir(), 'midst-follow-')),
        'jumping.midst'
      );
      writeFileSync(poemPath, doc.file);
      const { app, win } = await openReplay(poemPath, w.size);
      try {
        const last = doc.targets[doc.targets.length - 1];
        const rec = await record(win, async () => {
          await win.locator('[data-testid="PlayArrowIcon"]').first().click();
          await expect(
            win.locator('.ReplayContainer .ProseMirror p').nth(last)
          ).toContainText('z'.repeat(doc.typed), { timeout: 60_000 });
          await win.waitForTimeout(SETTLE_MS + 200);
        });
        assertFollows(`synthetic, ${at}, ${w.name}`, verdict(rec));
      } finally {
        await app.close();
      }
    });
  })
);

// "Follow the writing" turned off (GitHub #23): the page stays where the poet put it while the writing goes
// off screen, the choice survives a restart, and turning it back on follows again.
test('with Follow the writing off, replay does not scroll; on again after a restart, it follows', async () => {
  const doc = makeJumpingMidst('end');
  const poemPath = join(
    mkdtempSync(join(tmpdir(), 'midst-follow-off-')),
    'jumping.midst'
  );
  writeFileSync(poemPath, doc.file);
  const last = doc.targets[doc.targets.length - 1];
  const playToEnd = (win: Page) =>
    record(win, async () => {
      await win.locator('[data-testid="PlayArrowIcon"]').first().click();
      await expect(
        win.locator('.ReplayContainer .ProseMirror p').nth(last)
      ).toContainText('z'.repeat(doc.typed), { timeout: 60_000 });
      await win.waitForTimeout(SETTLE_MS + 200);
    });
  const follow = (win: Page) =>
    win.getByRole('button', { name: 'Follow the writing' });

  const first = await openReplay(poemPath);
  try {
    await expect(follow(first.win)).toHaveAttribute('aria-pressed', 'true');
    await follow(first.win).click();
    await expect(follow(first.win)).toHaveAttribute('aria-pressed', 'false');
    const off = verdict(await playToEnd(first.win));
    // eslint-disable-next-line no-console -- the measurement is the report
    console.log(`replay follow [off]: ${JSON.stringify(off)}`);
    // CONTROLS: the poem scrolls, and writing ended off screen, so following would have had to move.
    expect(off.viewport).toBeGreaterThan(0);
    expect(off.unfollowed, 'no writing ended off screen').toBeGreaterThan(0);
    expect(off.moves, 'scroll movements while following was off').toBe(0);
  } finally {
    await first.app.close();
  }
  // The choice is in the settings file the app relies on. Relaunch WITHOUT re-seeding it, as a poet's restart would.
  expect(readStore(first.userData)['replay-autoscroll']).toBe('false');

  const second = await openReplay(poemPath, null, false);
  try {
    await expect(follow(second.win)).toHaveAttribute('aria-pressed', 'false');
    await follow(second.win).click();
    await expect(follow(second.win)).toHaveAttribute('aria-pressed', 'true');
    assertFollows('on again', verdict(await playToEnd(second.win)));
  } finally {
    await second.app.close();
  }
});

WINDOWS.forEach((w) =>
  test(`replay follows Annelyse's Autoscroll Test Poem, gently (${w.name} window)`, async () => {
    const src = process.env.MIDST_AUTOSCROLL_POEM;
    test.skip(
      !src || !existsSync(src),
      'MIDST_AUTOSCROLL_POEM not set; poem files never live in this repository'
    );
    const poemPath = join(
      mkdtempSync(join(tmpdir(), 'midst-follow-')),
      'autoscroll.midst'
    );
    copyFileSync(src!, poemPath);
    const { app, win } = await openReplay(poemPath, w.size);
    try {
      const rec = await record(win, async () => {
        await win.locator('[data-testid="PlayArrowIcon"]').first().click();
        // Played to the end when the play button comes back.
        await expect(
          win.locator('[data-testid="PlayArrowIcon"]').first()
        ).toBeVisible({ timeout: 300_000 });
        await win.waitForTimeout(SETTLE_MS + 200);
      });
      assertFollows(`autoscroll test poem, ${w.name}`, verdict(rec));
    } finally {
      await app.close();
    }
  })
);
