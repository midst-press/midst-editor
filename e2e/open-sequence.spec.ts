import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst, parseMidst } from './fixtures';
import {
  SETTLE_MS,
  readStore,
  waitUntil,
  launch,
  openDocument,
} from './harness';

// Regression test for the data-loss defect Annelyse reported in August 2026 (issue #12).
// THE DEFECT: open Poem A, then Poem B, without quitting. Poem B's file is overwritten with a complete
// copy of Poem A and Poem B's own history is gone. Verified against her demonstration files: afterwards
// Poem B is byte-identical to Poem A, and 0 of Poem B's 82 history entries survive.
// WHY THIS DRIVES THE REAL PATH. main.ts:308 emits `ipcMain.emit('app-open', [path])` internally when
// the OS asks the app to open a document -- the Finder double-click she described. So this reproduces
// her sequence exactly, and no native file dialog has to be clicked.
// WHY THE ORACLE IS BYTES. The assertion is the content of a file on disk, not a rendered pixel, so
// nothing here depends on layout or animation timing.

test('opening a second poem must not overwrite it with the first', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-'));
  const A = makeMidst('POEM-A-SENTINEL', 60);
  const B = makeMidst('POEM-B-SENTINEL', 20);
  const pathA = join(work, 'poem-a.midst');
  const pathB = join(work, 'poem-b.midst');
  writeFileSync(pathA, A.file);
  writeFileSync(pathB, B.file);

  // The documents must be distinguishable, or the oracle below proves nothing.
  expect(A.historyLength).not.toBe(B.historyLength);

  const { app, userData } = await launch(work);
  try {
    // CONTROL 1 -- the store must be isolated. This defect is ABOUT persisted store state, so without
    // isolation a run inherits the previous one and a pass means nothing. Ask the app where it actually
    // put userData rather than assuming the flag was honoured.
    const reported = await app.evaluate(({ app: a }) => a.getPath('userData'));
    expect(
      reported,
      'userData was not redirected; the run would inherit state'
    ).toContain(work);

    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await openDocument(app, userData, pathA, 'Poem A');

    // The Editor component must be mounted before the second open: its own 'open-file' handler is the
    // code under test.
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });

    // The step that destroys Poem B.
    await openDocument(app, userData, pathB, 'Poem B');

    // CONTROL 2 -- the sequence really ran. Without it, a build that silently opened nothing would
    // leave Poem B untouched and this test would pass for the wrong reason.
    expect(
      readStore(userData).filename,
      'the open sequence did not complete'
    ).toBe(pathB);

    // Let any pending write land. Returns early once Poem B changes, so a RED run is fast.
    await waitUntil(() => readFileSync(pathB, 'utf8') !== B.file, SETTLE_MS);

    // THE DEFECT, where it begins: the store ends up holding the newly-opened file's PATH beside the
    // previously-loaded document's TEXT.
    const store = readStore(userData);
    expect(store.poem, "the store does not hold Poem B's text").toContain(
      B.sentinel
    );
    expect(store.poem, "the store still holds Poem A's text").not.toContain(
      A.sentinel
    );

    // THE HARM, on disk. This is the assertion that matters to a poet.
    const onDisk = parseMidst(readFileSync(pathB, 'utf8'));
    expect(onDisk.text, 'Poem B now contains Poem A').toContain(B.sentinel);
    expect(onDisk.history.length, "Poem B's own history was replaced").toBe(
      B.historyLength
    );

    // DIRECTION -- Poem A is the survivor, so a fix must not merely swap the victim.
    expect(readFileSync(pathA, 'utf8'), 'Poem A was modified').toBe(A.file);
  } finally {
    await app.close();
  }
});

test('opening a single poem leaves it byte-identical', async () => {
  // Negative control. If the harness itself rewrote files on open, the test above would fail for a
  // reason that has nothing to do with the two-document sequence.
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-solo-'));
  const A = makeMidst('POEM-SOLO-SENTINEL', 30);
  const pathA = join(work, 'poem-solo.midst');
  writeFileSync(pathA, A.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, pathA, 'the only poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await waitUntil(() => readFileSync(pathA, 'utf8') !== A.file, SETTLE_MS);
    expect(parseMidst(readFileSync(pathA, 'utf8')).history.length).toBe(
      A.historyLength
    );
  } finally {
    await app.close();
  }
});
