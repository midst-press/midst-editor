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

type Sample = [number, number, boolean, number, number]; // paragraph, char, visible, scrollTop, ms
const SETTLE_MS = 500;

type Rec = { samples: Sample[]; viewport: number; tops: number[] };
async function record(win: Page, done: () => Promise<void>): Promise<Rec> {
  await win.evaluate(() => {
    const g = globalThis as unknown as {
      fs?: Sample[];
      ft?: ReturnType<typeof setInterval>;
      fv?: number;
      fts?: number[];
    };
    g.fts = [];
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
    const t0 = performance.now();
    g.ft = setInterval(() => {
      const pm = document.querySelector(
        '.ReplayContainer .ProseMirror'
      ) as HTMLElement | null;
      const s = scroller(pm);
      if (!pm || !s) return;
      g.fv = s.clientHeight;
      g.fts!.push(s.scrollTop);
      const ps = Array.from(pm.children) as HTMLElement[];
      const now = ps.map((p) => p.textContent ?? '');
      const k =
        last.length === now.length
          ? now.findIndex((t, i) => t !== last[i])
          : -1;
      const prev = last[k] ?? '';
      last = now;
      if (k < 0) return;
      let c = 0;
      while (c < now[k].length && now[k][c] === prev[c]) c += 1;
      // A Range at character c of paragraph k: walk its text nodes.
      const walk = document.createTreeWalker(ps[k], NodeFilter.SHOW_TEXT);
      let n = walk.nextNode() as Text | null;
      let left = c;
      while (n && left > n.length) {
        left -= n.length;
        n = walk.nextNode() as Text | null;
      }
      const box = s.getBoundingClientRect();
      let r = ps[k].getBoundingClientRect();
      if (n) {
        const range = document.createRange();
        range.setStart(n, Math.min(left, n.length));
        range.setEnd(n, Math.min(left, n.length));
        const rr = range.getBoundingClientRect();
        if (rr.height) r = rr;
      }
      g.fs!.push([
        k,
        c,
        r.top >= box.top && r.bottom <= box.bottom,
        s.scrollTop,
        performance.now() - t0,
      ]);
    }, 20);
  });
  await done();
  return win.evaluate(() => {
    const g = globalThis as unknown as {
      fs?: Sample[];
      ft?: ReturnType<typeof setInterval>;
      fv?: number;
      fts?: number[];
    };
    if (g.ft) clearInterval(g.ft);
    return { samples: g.fs ?? [], viewport: g.fv ?? 0, tops: g.fts ?? [] };
  });
}

// Stretches of writing in one place: consecutive samples on the same paragraph whose character moves by
// less than 40 (typing, not a jump within a long line).
function verdict({ samples, viewport, tops }: Rec) {
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
  let abrupt = 0;
  // Every 20ms tick, whether or not the text changed: a glide's per-tick move, not a per-frame one.
  for (let i = 1; i < tops.length; i += 1)
    if (Math.abs(tops[i] - tops[i - 1]) > viewport / 3) abrupt += 1;
  const scrolled = new Set(samples.map((s) => s[3])).size > 1;
  return {
    samples: samples.length,
    settled: settled.length,
    unfollowed,
    abrupt,
    scrolled,
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
}

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
