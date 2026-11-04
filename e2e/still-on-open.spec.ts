import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MIDST_VERSION_HEADER } from './fixtures';
import { launch, openDocument } from './harness';

// GitHub #107, editor #393: with Check Spelling on, a saved poem opened with the caret running down the end of
// every line, twice. The whole-poem spell check (checkWholePoem.ts) moves the native caret to each paragraph's
// end; it must not be seen there. The caret is sampled every 3 ms while the poem opens. Invented words only.

const LINES = ['zq one', 'xv two', 'qz three', 'vx four', 'zz five', 'qq six'];

type Sample = { paragraph: number; offset: number; color: string };

test('a saved poem opens with the caret still: the spell check never shows it away from the start', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-still-on-open-'));
  const text = LINES.map((l) => `<p>${l}</p>`).join('');
  const history = [
    { inserted: text, front: 0, end: 0, t: '2026-08-22T20:00:00.000Z', pos: 2 },
  ];
  const poemPath = join(work, 'still.midst');
  writeFileSync(
    poemPath,
    `${MIDST_VERSION_HEADER}\n${JSON.stringify({ text, history })}`
  );
  const userData = join(work, 'userdata');
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, 'config.json'),
    JSON.stringify({ edited: false, spellcheck: 'true' })
  );

  const { app } = await launch(work, { seed: false });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.evaluate(() => {
      const g = window as unknown as { samples: Sample[] };
      g.samples = [];
      setInterval(() => {
        const dom = document.querySelector('.ProseMirror');
        const sel = document.getSelection();
        if (!dom || !sel?.anchorNode || !dom.contains(sel.anchorNode)) return;
        g.samples.push({
          paragraph: Array.from(dom.children).findIndex((p) =>
            p.contains(sel.anchorNode)
          ),
          offset: sel.anchorOffset,
          color: getComputedStyle(dom).caretColor,
        });
      }, 3);
    });
    await openDocument(app, userData, poemPath, 'the poem');
    await expect(win.locator('.ProseMirror')).toHaveAttribute(
      'spellcheck',
      'true'
    );
    // Both checks (FIRST_MS and AGAIN_MS) are over well within this.
    await win.waitForTimeout(4_000);
    const samples = await win.evaluate(
      () => (window as unknown as { samples: Sample[] }).samples
    );

    const away = samples.filter((s) => s.paragraph !== 0 || s.offset !== 0);
    // CONTROL: the check ran and moved the caret, to the last paragraph too, so a clean result below is not
    // a check that never started.
    expect(
      away.some((s) => s.paragraph === LINES.length - 1),
      'the spell check never moved the caret; this test saw nothing'
    ).toBe(true);
    const shown = away.filter((s) => s.color !== 'rgba(0, 0, 0, 0)');
    expect(
      shown,
      'the caret was visible away from the start while the poem opened'
    ).toEqual([]);
    // And it is back at the start, visible, once the checks are done.
    const last = samples[samples.length - 1];
    expect([last.paragraph, last.offset]).toEqual([0, 0]);
    expect(last.color).not.toBe('rgba(0, 0, 0, 0)');
  } finally {
    await app.close();
  }
});
