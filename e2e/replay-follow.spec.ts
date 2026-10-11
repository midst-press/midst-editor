import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeJumpingMidst } from './fixtures';
import { launch, openDocument } from './harness';
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
    const t0 = performance.now();
    g.ft = setInterval(() => {
      const pm = document.querySelector(
        '.ReplayContainer .ProseMirror'
      ) as HTMLElement | null;
      const s = scroller(pm);
      if (!pm || !s) return;
      g.fv = s.clientHeight;
      const clamped =
        s.scrollHeight < lastHeight &&
        Math.abs(s.scrollTop - (s.scrollHeight - s.clientHeight)) < 1;
      lastHeight = s.scrollHeight;
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
  for (let i = 1; i < tops.length; i += 1)
    if (moving[i] && Math.abs(tops[i] - tops[i - 1]) > viewport / 3)
      abrupt += 1;
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
  };
}

async function openReplay(
  poemPath: string
): Promise<{ app: ElectronApplication; win: Page }> {
  const { app, userData } = await launch(join(poemPath, '..'));
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await openDocument(app, userData, poemPath, 'the poem');
  await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
  await win.getByRole('link', { name: 'Replay' }).click();
  await expect(win.locator('.ReplayContainer')).toBeVisible({
    timeout: 25_000,
  });
  return { app, win };
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

(['end', 'middle'] as const).forEach((at) => {
  test(`replay follows jumping writing, gently (typing at the ${at} of a line)`, async () => {
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
    const { app, win } = await openReplay(poemPath);
    try {
      const last = doc.targets[doc.targets.length - 1];
      const rec = await record(win, async () => {
        await win.locator('[data-testid="PlayArrowIcon"]').first().click();
        await expect(
          win.locator('.ReplayContainer .ProseMirror p').nth(last)
        ).toContainText('z'.repeat(doc.typed), { timeout: 60_000 });
        await win.waitForTimeout(SETTLE_MS + 200);
      });
      assertFollows(`synthetic, ${at}`, verdict(rec));
    } finally {
      await app.close();
    }
  });
});

test("replay follows Annelyse's Autoscroll Test Poem, gently", async () => {
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
  const { app, win } = await openReplay(poemPath);
  try {
    const rec = await record(win, async () => {
      await win.locator('[data-testid="PlayArrowIcon"]').first().click();
      // Played to the end when the play button comes back.
      await expect(
        win.locator('[data-testid="PlayArrowIcon"]').first()
      ).toBeVisible({ timeout: 300_000 });
      await win.waitForTimeout(SETTLE_MS + 200);
    });
    assertFollows('autoscroll test poem', verdict(rec));
  } finally {
    await app.close();
  }
});
