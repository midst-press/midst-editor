import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst, parseMidst } from './fixtures';
import {
  SETTLE_MS,
  clickCheckSpelling,
  launch,
  openDocument,
  readStore,
  waitUntil,
} from './harness';

// Autosave is a 1000ms debounce set in `onUpdate` (Editor/index.tsx): every keystroke clears the
// previous timer and schedules `saveFileAndUpdateStore`. `setTimeout` invokes it with NO arguments,
// so it falls back to its parameter defaults -- which are read from the closure of the render in
// which `onUpdate` ran, i.e. BEFORE that keystroke's state update landed.
//
// Nonsense strings throughout. No poem content belongs in this repository.
const TYPED = 'ZZQ';

test('autosave stores the text as it stands when the timer fires', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-autosave-'));
  const A = makeMidst('POEM-LAG-SENTINEL', 10);
  const pathA = join(work, 'poem-lag.midst');
  writeFileSync(pathA, A.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, pathA, 'the poem');
    const pm = win.locator('.ProseMirror');
    await expect(pm).toBeVisible({ timeout: 25_000 });

    await pm.click();
    await win.keyboard.press('End');
    await win.keyboard.type(TYPED, { delay: 60 });

    // CONTROL: the editor received every character. Without this, a failure below could just mean
    // the keystrokes never arrived, which would make the test's verdict meaningless.
    const visible = await pm.innerText();
    expect(visible, 'the keystrokes never reached the editor').toContain(TYPED);

    // Past the debounce. Returns early on success so a green run is fast.
    await waitUntil(
      () => (readStore(userData).poem ?? '').includes(TYPED),
      4_000
    );

    const stored = readStore(userData).poem ?? '';
    expect(
      stored,
      `the editor shows ...${visible.slice(
        -12
      )} but autosave stored ...${stored.slice(-40)}`
    ).toContain(TYPED);
  } finally {
    await app.close();
  }
});

test('an autosave pending from one poem must not land in the next', async () => {
  // The SECOND route into #12. The fix in b5d4741 passes the document explicitly through the
  // 'open-file' handler, which closes the synchronous route. A timer scheduled while poem A was
  // being typed is a different carrier: it holds A's text in its defaults and fires ~1s later,
  // by which time store.filename points at B.
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-race-'));
  const A = makeMidst('POEM-RACE-A-SENTINEL', 40);
  const B = makeMidst('POEM-RACE-B-SENTINEL', 15);
  const pathA = join(work, 'race-a.midst');
  const pathB = join(work, 'race-b.midst');
  writeFileSync(pathA, A.file);
  writeFileSync(pathB, B.file);
  expect(A.historyLength).not.toBe(B.historyLength);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, pathA, 'Poem A');
    const pm = win.locator('.ProseMirror');
    await expect(pm).toBeVisible({ timeout: 25_000 });

    await pm.click();
    await win.keyboard.press('End');
    await win.keyboard.type(TYPED, { delay: 20 });

    // CONTROL: typing landed in A, so a pending timer exists to race with.
    expect(
      await pm.innerText(),
      'nothing was typed, so there is no pending autosave to test'
    ).toContain(TYPED);

    // CONTROL: the autosave has NOT yet fired, so the window this test needs is real. Without it a
    // pass is uninterpretable -- a timer that had already landed would leave Poem B untouched for a
    // reason with nothing to do with the race.
    //
    // It is also the churn detector. If the mount effect at Editor/index.tsx:65 re-registered on
    // every render -- which is what adding a per-keystroke `saveFileAndUpdateStore` identity to its
    // deps would cause -- it would call save on every character and the store would already be
    // current here.
    expect(
      readStore(userData).poem ?? '',
      'the autosave had already landed, so the race was never exercised (or the mount effect is saving on every keystroke)'
    ).not.toContain(TYPED);

    // Open B INSIDE the 1000ms debounce window.
    await openDocument(app, userData, pathB, 'Poem B');
    expect(
      readStore(userData).filename,
      'the open sequence did not complete'
    ).toBe(pathB);

    // Give the stale timer every chance to fire.
    await waitUntil(() => readFileSync(pathB, 'utf8') !== B.file, SETTLE_MS);

    const onDisk = parseMidst(readFileSync(pathB, 'utf8'));
    expect(onDisk.text, 'Poem B now contains Poem A').not.toContain(A.sentinel);
    expect(onDisk.text, 'Poem B lost its own text').toContain(B.sentinel);
    expect(
      onDisk.history.length,
      "Poem B's history was replaced by Poem A's"
    ).not.toBe(A.historyLength);
  } finally {
    await app.close();
  }
});

// The Replay button unmounts the editor, and the editor's clean-up cancels a pending autosave. Clicked
// inside the second after a keystroke, it used to leave those keystrokes out of the file until the
// poet came back to the editor, and for good if they quit from the replay (#77).
test('going to the replay by its button straight after typing saves what was typed', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-replay-button-'));
  const doc = makeMidst('REPLAY-BUTTON', 0);
  const poemPath = join(work, 'typed.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem to type in');
    const editor = win.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 25_000 });
    const before = parseMidst(readFileSync(poemPath, 'utf8')).history.length;

    await editor.click();
    await win.keyboard.type('zqx');
    await win.getByRole('link', { name: 'Timeline' }).click();
    await expect(win.locator('.ReplayContainer')).toBeVisible({
      timeout: 25_000,
    });

    // Longer than the autosave delay, so a save that was only delayed would have landed too.
    const reached = await waitUntil(
      () => readFileSync(poemPath, 'utf8').includes('zqx'),
      4_000
    );
    expect(reached, 'the typed text never reached the file').toBe(true);
    const saved = parseMidst(readFileSync(poemPath, 'utf8'));
    expect(saved.history.length).toBeGreaterThan(before);
    // The replay shows the same history the file now holds.
    expect(readStore(userData).history).toBe(JSON.stringify(saved.history));
  } finally {
    await app.close();
  }
});

// Toggling spellcheck reloads the window, and the reloaded editor takes its text from the store. An
// autosave still pending when the reload happens dies with the page, so the keystrokes of the last
// second used to be gone from the window and, once the reloaded editor saved, from the file (#79).
test('toggling spellcheck straight after typing keeps what was typed', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-spellcheck-'));
  const doc = makeMidst('SPELLCHECK', 0);
  const poemPath = join(work, 'typed.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem to type in');
    const editor = win.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 25_000 });

    await editor.click();
    await win.keyboard.type('zqx');
    // The real Edit > Check Spelling item (editor #320).
    await clickCheckSpelling(app);
    // CONTROL: the toggle took effect, so the window did reload.
    expect(
      await waitUntil(() => readStore(userData).spellcheck === 'true', 10_000),
      'the spellcheck setting never changed, so nothing was reloaded'
    ).toBe(true);

    // The reload shows the opening screen, which reads the stored text when the poet goes on. So the
    // store is what the reloaded window will show, and the file is what the poet keeps.
    expect(
      await waitUntil(
        () => (readStore(userData).poem ?? '').includes('zqx'),
        4_000
      ),
      'the stored text, which the reloaded window shows, is missing what was typed'
    ).toBe(true);
    expect(
      await waitUntil(
        () => readFileSync(poemPath, 'utf8').includes('zqx'),
        4_000
      ),
      'the typed text is not in the file'
    ).toBe(true);
  } finally {
    await app.close();
  }
});
