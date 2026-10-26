import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import {
  checkSpellingMark,
  clickCheckSpelling,
  launch,
  openDocument,
  readStore,
  waitUntil,
} from './harness';

// Does switching spellcheck on leave the poet in their poem?
//
// The toggle reloads the window so that the whole text is checked again. The reload used to start the
// app at its opening screen, with the poem still open underneath and the poet no longer in it (#86).
// Invented letters only.

// The real Edit > Check Spelling item: it owns the setting and its checkmark (editor #320).
const toggleSpellcheck = clickCheckSpelling;

test('toggling spellcheck comes back to the poem, with the setting applied', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-spellcheck-stay-'));
  const doc = makeMidst('STAYS', 0);
  const poemPath = join(work, 'stay.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem');
    const editor = win.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 25_000 });
    // CONTROL: spellcheck starts off, so "true" below was put there by the toggle.
    await expect(editor).toHaveAttribute('spellcheck', 'false');
    await editor.click();
    await win.keyboard.type('zqx');

    await toggleSpellcheck(app);
    expect(
      await waitUntil(() => readStore(userData).spellcheck === 'true', 10_000),
      'the spellcheck setting never changed'
    ).toBe(true);

    await expect(
      win.locator('.ProseMirror'),
      'after the toggle the poet is not in the editor'
    ).toBeVisible({ timeout: 25_000 });
    await expect(win.locator('.ProseMirror')).toHaveAttribute(
      'spellcheck',
      'true'
    );
    await expect(win.locator('.ProseMirror')).toContainText('zqx');

    // And off again, the same way.
    await toggleSpellcheck(app);
    expect(
      await waitUntil(() => readStore(userData).spellcheck === 'false', 10_000),
      'the spellcheck setting never changed back'
    ).toBe(true);
    await expect(win.locator('.ProseMirror')).toHaveAttribute(
      'spellcheck',
      'false',
      { timeout: 25_000 }
    );
    await expect(win.locator('.ProseMirror')).toContainText('zqx');
  } finally {
    await app.close();
  }
});

test('a fresh start still shows the opening screen, not the editor', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-spellcheck-fresh-'));
  const { app } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expect(win.locator('#root')).not.toBeEmpty({ timeout: 25_000 });
    await win.waitForTimeout(1_500);
    expect(await win.locator('.ProseMirror').count()).toBe(0);
  } finally {
    await app.close();
  }
});

// The poem's own text drawn transparent, so a count sees only what Chromium draws for it, the spelling marks.
// On GitHub's Ubuntu runner 49 pixels in the box counted as red with spellcheck off; the text is the only thing
// drawn there, and its antialiasing is the likely source. Toggling spellcheck reloads the window, so this is
// applied again after it.
const hideText = async (
  win: Awaited<
    ReturnType<Awaited<ReturnType<typeof launch>>['app']['firstWindow']>
  >
) => {
  await win.addStyleTag({
    content:
      '.ProseMirror, .ProseMirror * { color: transparent !important; caret-color: transparent !important; }',
  });
  // CONTROL: the style reached the poem.
  await expect(win.locator('.ProseMirror')).toHaveCSS(
    'color',
    'rgba(0, 0, 0, 0)'
  );
};

// Red underline pixels in the editor, read in the main process from the window itself. Spelling marks are
// drawn by Chromium below the DOM, so nothing in the page can see them. The thresholds are Silas's, calibrated
// on #238: 0 before any typing, every misspelled word marked after.
const redPixels = async (
  app: Awaited<ReturnType<typeof launch>>['app'],
  win: Awaited<
    ReturnType<Awaited<ReturnType<typeof launch>>['app']['firstWindow']>
  >
) => {
  const box = await win.locator('.ProseMirror').boundingBox();
  if (!box) throw new Error('the editor has no box');
  return app.evaluate(
    async ({ BrowserWindow }, rect) => {
      const image =
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect);
      const bgra = image.toBitmap();
      let n = 0;
      for (let i = 0; i < bgra.length; i += 4) {
        const [b, g, r] = [bgra[i], bgra[i + 1], bgra[i + 2]];
        if (r > 180 && r - g > 60 && r - b > 60) n += 1;
      }
      return n;
    },
    {
      x: Math.floor(box.x),
      y: Math.floor(box.y),
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
    }
  );
};

test('switching spellcheck on marks the misspelled words before anything is typed, and changes nothing (#238)', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-spellcheck-marks-'));
  const poemPath = join(work, 'marks.midst');
  writeFileSync(poemPath, makeMidst('Thsi wrod isz badd', 0).file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem');
    const editor = win.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 25_000 });
    // CONTROL: with spellcheck off nothing is red, so red below is the marks.
    await hideText(win);
    await win.waitForTimeout(1_000);
    expect(await redPixels(app, win)).toBe(0);

    await toggleSpellcheck(app);
    expect(
      await waitUntil(() => readStore(userData).spellcheck === 'true', 10_000),
      'the spellcheck setting never changed'
    ).toBe(true);
    await expect(win.locator('.ProseMirror')).toHaveAttribute(
      'spellcheck',
      'true',
      {
        timeout: 25_000,
      }
    );
    const stored = readStore(userData);

    await hideText(win);
    await expect
      .poll(() => redPixels(app, win), {
        message: 'no word was marked before typing',
        timeout: 5_000,
      })
      .toBeGreaterThan(0);

    // The edit that made Chromium look is in neither the poem nor its history, nor does an undo bring it back.
    await expect(win.locator('.ProseMirror')).toHaveText('Thsi wrod isz badd');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.undo()
    );
    await win.waitForTimeout(1_000);
    await expect(win.locator('.ProseMirror')).toHaveText('Thsi wrod isz badd');
    const after = readStore(userData);
    expect([after.poem, after.history, after.edited]).toEqual([
      stored.poem,
      stored.history,
      stored.edited,
    ]);
  } finally {
    await app.close();
  }
});

// The mark and the setting agree wherever the poet is (GitHub #80, editor #320). Only the writing screen
// listens for the toggle, so in Timeline mode the menu has to change the setting itself; the writing screen
// applies it when the poet returns.
test('Check Spelling from Timeline mode changes the setting and its checkmark, applied on returning to Edit', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-spellcheck-timeline-'));
  const doc = makeMidst('TIMELINE', 0);
  const poemPath = join(work, 'timeline.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    // CONTROL: off, and the mark says so.
    expect(await checkSpellingMark(app)).toBe(false);

    await win.getByRole('button', { name: 'Timeline' }).click();
    await expect(win.locator('.ReplayContainer')).toBeVisible({
      timeout: 25_000,
    });
    await clickCheckSpelling(app);
    expect(
      await waitUntil(() => readStore(userData).spellcheck === 'true', 10_000),
      'Check Spelling in Timeline mode did not change the setting'
    ).toBe(true);
    expect(
      await checkSpellingMark(app),
      'the mark disagrees with the setting'
    ).toBe(true);

    await win.getByRole('button', { name: 'Edit' }).click();
    await expect(win.locator('.ProseMirror')).toHaveAttribute(
      'spellcheck',
      'true',
      { timeout: 25_000 }
    );
  } finally {
    await app.close();
  }
});

// Annelyse's cases on GitHub #71 (editor #238, reopened 26 Oct). Each is measured the same way as above: red
// underline pixels with the text made transparent, here inside each line's own box. Invented letters only.
type Win = Awaited<
  ReturnType<Awaited<ReturnType<typeof launch>>['app']['firstWindow']>
>;
type App = Awaited<ReturnType<typeof launch>>['app'];

// Red pixels inside each paragraph of the poem, in order.
// `lines` limits it to the first so many: a line scrolled out of the window cannot be captured.
const redPerLine = async (app: App, win: Win, lines = Infinity) => {
  const boxes = await win.evaluate(
    (n) =>
      [...document.querySelectorAll('.ProseMirror p')].slice(0, n).map((p) => {
        const r = p.getBoundingClientRect();
        return {
          x: Math.floor(r.x),
          y: Math.floor(r.y),
          width: Math.ceil(r.width),
          height: Math.ceil(r.height) + 4,
        };
      }),
    lines
  );
  return app.evaluate(
    async ({ BrowserWindow }, rects) =>
      // One capture per line, in order.
      rects.reduce<Promise<number[]>>(async (sofar, rect) => {
        const counts = await sofar;
        const bgra = (
          await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect)
        ).toBitmap();
        let n = 0;
        for (let i = 0; i < bgra.length; i += 4) {
          if (
            bgra[i + 2] > 180 &&
            bgra[i + 2] - bgra[i + 1] > 60 &&
            bgra[i + 2] - bgra[i] > 60
          )
            n += 1;
        }
        return [...counts, n];
      }, Promise.resolve([])),
    boxes
  );
};

// A poem open in the editor, with the caret at its end.
async function openPoem(prefix: string) {
  const work = mkdtempSync(join(tmpdir(), `midst-spellcheck-${prefix}-`));
  const poemPath = join(work, `${prefix}.midst`);
  // A misspelled first line, so a test can see that spellcheck is marking before it types (turnSpellcheckOn).
  writeFileSync(poemPath, makeMidst('zqxvk', 0).file);
  const { app, userData } = await launch(work);
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await openDocument(app, userData, poemPath, 'the poem');
  await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
  return { app, win, userData };
}

async function turnSpellcheckOn(app: App, win: Win, userData: string) {
  await clickCheckSpelling(app);
  expect(
    await waitUntil(() => readStore(userData).spellcheck === 'true', 10_000)
  ).toBe(true);
  await expect(win.locator('.ProseMirror')).toHaveAttribute(
    'spellcheck',
    'true',
    { timeout: 25_000 }
  );
}

// Marking has begun: the poem's first line is marked. On Linux a word typed straight after the switch was not, while
// the whole-poem check a second later was (run 12021), so a test that types after the switch waits for this first.
async function markingHasBegun(app: App, win: Win) {
  await hideText(win);
  await expect
    .poll(async () => (await redPerLine(app, win, 1))[0], {
      message: 'spellcheck never marked the first line',
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

// Keys sent at once can reach ProseMirror before it has read a caret move, and Enter then breaks the line where
// the caret was (measured on #238). So a caret move is waited out until ProseMirror's own selection shows it.
async function caretAt(win: Win, where: 'start' | 'end') {
  await expect
    .poll(
      () =>
        win.evaluate((at) => {
          const { state } = (
            document.querySelector('.ProseMirror') as unknown as {
              editor: {
                state: {
                  selection: { head: number };
                  doc: { content: { size: number } };
                };
              };
            }
          ).editor;
          const want = at === 'start' ? 1 : state.doc.content.size - 1;
          return state.selection.head === want;
        }, where),
      { message: `the caret never reached the ${where}`, timeout: 5_000 }
    )
    .toBe(true);
}

// The poem's lines as the page shows them, for a failure message.
const linesShown = (win: Win) =>
  win.evaluate(() =>
    JSON.stringify(
      [...document.querySelectorAll('.ProseMirror p')].map((p) => p.textContent)
    )
  );

async function typeAtEnd(win: Win, keys: (string | 'Enter')[]) {
  await win.locator('.ProseMirror').click();
  await win.keyboard.press(
    process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'
  );
  await caretAt(win, 'end');
  // Keystrokes in order.
  await keys.reduce(
    (sofar, k) =>
      sofar.then(() =>
        k === 'Enter' ? win.keyboard.press('Enter') : win.keyboard.type(k)
      ),
    Promise.resolve()
  );
}

test.describe("Annelyse's spellcheck cases (GitHub #71, editor #238)", () => {
  test('a misspelled word ended by a space is marked (CONTROL for the line-break case)', async () => {
    const { app, win, userData } = await openPoem('space');
    try {
      await turnSpellcheckOn(app, win, userData);
      await markingHasBegun(app, win);
      await typeAtEnd(win, ['Enter', 'lskfjas ']);
      await hideText(win);
      const lines = await linesShown(win);
      await expect
        .poll(async () => (await redPerLine(app, win))[1], {
          message: `the typed word is not marked; the lines were ${lines}`,
          timeout: 5_000,
        })
        .toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  test('case 2: a misspelled word ended by a line break is marked', async () => {
    const { app, win, userData } = await openPoem('break');
    try {
      await turnSpellcheckOn(app, win, userData);
      await markingHasBegun(app, win);
      await typeAtEnd(win, ['Enter', 'lskfjas', 'Enter', 'q']);
      await hideText(win);
      await expect
        .poll(async () => (await redPerLine(app, win))[1], {
          message: 'the word before the line break is not marked',
          timeout: 5_000,
        })
        .toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  test('case 3: misspelled words each on their own line are all marked', async () => {
    const { app, win, userData } = await openPoem('lines');
    try {
      await turnSpellcheckOn(app, win, userData);
      await markingHasBegun(app, win);
      await typeAtEnd(win, [
        'Enter',
        'dsflkaj',
        'Enter',
        'qwzpxvb',
        'Enter',
        'vbnmtrw',
        'Enter',
        'q',
      ]);
      await hideText(win);
      await expect
        .poll(
          async () =>
            (await redPerLine(app, win)).slice(1, 4).every((n) => n > 0),
          {
            message: 'not every misspelled line is marked',
            timeout: 5_000,
          }
        )
        .toBe(true);
    } finally {
      await app.close();
    }
  });

  test('case 4: breaking the line after a marked word keeps the next line marked', async () => {
    // Not fixed yet (editor #238), and not every time: the next line kept its mark in 3 of 10 runs, so as an
    // expected failure it would turn CI red at random. Skipped until the cause is known; then test.fail().
    test.fixme();
    const { app, win, userData } = await openPoem('split');
    try {
      await turnSpellcheckOn(app, win, userData);
      await markingHasBegun(app, win);
      await typeAtEnd(win, ['Enter', 'dsflkajsdf ', 'Enter', 'sfazqwx ']);
      await hideText(win);
      // CONTROL: both lines are marked before the break.
      await expect
        .poll(
          async () =>
            (await redPerLine(app, win)).slice(1, 3).every((n) => n > 0),
          { timeout: 5_000 }
        )
        .toBe(true);
      // Break after the first misspelled line: the caret to the end of line 2, then Enter.
      await win.locator('.ProseMirror p').nth(1).click();
      await win.keyboard.press('End');
      await win.keyboard.press('Enter');
      await expect
        .poll(async () => (await redPerLine(app, win))[3], {
          message: 'the moved line lost its mark',
          timeout: 5_000,
        })
        .toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  test('case 1: switching spellcheck on marks a many-line poem without typing', async () => {
    const { app, win, userData } = await openPoem('many');
    try {
      const lines = Array.from(
        { length: 12 },
        (_, i) => `zq${'xvbnmt'.slice(0, (i % 5) + 2)}wq `
      );
      await typeAtEnd(
        win,
        lines.flatMap((l) => ['Enter', l])
      );
      await turnSpellcheckOn(app, win, userData);
      await hideText(win);
      await expect
        .poll(
          async () =>
            (await redPerLine(app, win)).slice(1).filter((n) => n > 0).length,
          {
            message: 'lines left unmarked until typing',
            timeout: 5_000,
          }
        )
        .toBe(lines.length);
    } finally {
      await app.close();
    }
  });

  test('case 5: switching spellcheck keeps the place in a long poem', async () => {
    const { app, win, userData } = await openPoem('scroll');
    try {
      await typeAtEnd(
        win,
        Array.from({ length: 80 }, (_, i) => ['Enter', `line ${i}`]).flat()
      );
      const scrollTop = () =>
        win.evaluate(() => {
          let e = document.querySelector('.ProseMirror') as HTMLElement | null;
          while (
            e &&
            !(
              e.scrollHeight > e.clientHeight + 1 &&
              getComputedStyle(e).overflowY !== 'visible'
            )
          )
            e = e.parentElement;
          return e ? e.scrollTop : (document.scrollingElement?.scrollTop ?? -1);
        });
      // The cursor at the top and the page scrolled to the bottom, so the place kept is not where the cursor is:
      // only putting the scroll position back keeps the view here; focusing the cursor would take it to the top
      // (River, review of #322).
      // The view follows the caret a few frames after the key, so each scroll is waited out until it holds: a
      // bottom set while the caret's scroll is still coming is undone before the toggle, and 0 is what is kept.
      const settledScrollTop = () =>
        win.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const dom = document.querySelector('.ProseMirror') as HTMLElement;
              let last = dom.scrollTop;
              let still = 0;
              const tick = () => {
                still = dom.scrollTop === last ? still + 1 : 0;
                last = dom.scrollTop;
                if (still >= 10) resolve(last);
                else requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            })
        );
      await win.keyboard.press(
        process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'
      );
      await caretAt(win, 'start');
      // Near the top, not at 0: on Linux the view settled at 2 (run 11956).
      await expect.poll(settledScrollTop, { timeout: 5_000 }).toBeLessThan(50);
      await win.evaluate(() => {
        const dom = document.querySelector('.ProseMirror') as HTMLElement;
        dom.scrollTop = dom.scrollHeight;
      });
      await settledScrollTop();
      const before = await scrollTop();
      // CONTROL: the view is far from the top, where the cursor is.
      expect(before).toBeGreaterThan(200);
      await turnSpellcheckOn(app, win, userData);
      await expect
        .poll(scrollTop, {
          message: 'the poem jumped after the toggle',
          timeout: 5_000,
        })
        .toBeGreaterThan(before - 50);
    } finally {
      await app.close();
    }
  });
});
