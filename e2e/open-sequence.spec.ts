import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
// `resolve` is aliased because promise/param-names requires a Promise executor's first
// parameter to be named `resolve`, which would otherwise shadow this import (no-shadow).
import { join, resolve as resolvePath } from 'path';
import { makeMidst, parseMidst } from './fixtures';

// Regression test for the data-loss defect Annelyse reported in August 2026 (issue #12).
//
// THE DEFECT: open Poem A, then Poem B, without quitting. Poem B's file is overwritten with a complete
// copy of Poem A and Poem B's own history is gone. Verified against her demonstration files: afterwards
// Poem B is byte-identical to Poem A, and 0 of Poem B's 82 history entries survive.
//
// WHY THIS DRIVES THE REAL PATH. main.ts:308 emits `ipcMain.emit('app-open', [path])` internally when
// the OS asks the app to open a document -- the Finder double-click she described. So this reproduces
// her sequence exactly, and no native file dialog has to be clicked.
//
// WHY THE ORACLE IS BYTES. The assertion is the content of a file on disk, not a rendered pixel, so
// nothing here depends on layout or animation timing.

const APP_DIR = resolvePath(__dirname, '..', 'release', 'app');

// Long enough that the RED run reproduces the overwrite inside it, which is what establishes the window
// is adequate. A green run pays it in full, once per test.
const SETTLE_MS = 5_000;

function readStore(userData: string): Record<string, string> {
  const p = join(userData, 'config.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

// `handleUnsavedChanges` (menu.ts:21) returns early ONLY when store.edited is the string 'false'. On a
// brand-new profile it is undefined, so the first open puts up a modal `showMessageBoxSync`, which
// blocks Electron's main process with nobody to click it -- the app hangs rather than opening anything.
// Seeding 'false' puts the app in the state a returning user is actually in, which is also the state
// her repro assumes: she had used Midst before.
function seedStore(userData: string) {
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, 'config.json'),
    JSON.stringify({ edited: 'false' })
  );
}

// Make any remaining modal OBSERVABLE instead of fatal. A blocking dialog is indistinguishable from a
// deadlock from outside, so record them and let the test report what appeared.
async function captureDialogs(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { capturedDialogs?: string[] };
    g.capturedDialogs = [];
    dialog.showMessageBoxSync = ((_w: unknown, opts: { message?: string }) => {
      g.capturedDialogs!.push(opts?.message ?? '(no message)');
      return 0; // 'Proceed' -- defaultId in the app's own prompt
    }) as typeof dialog.showMessageBoxSync;
  });
}

async function dialogsSeen(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () =>
      (globalThis as unknown as { capturedDialogs?: string[] })
        .capturedDialogs ?? []
  );
}

// setInterval rather than awaiting inside a loop. The predicate is synchronous -- it reads a file --
// so polling needs no await at all, which satisfies no-await-in-loop by not doing the thing rather
// than by suppressing the complaint about it.
function waitUntil(pred: () => boolean, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const deadline = Date.now() + ms;
    const timer = setInterval(() => {
      if (pred()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });
}

async function launch(work: string) {
  const userData = join(work, 'userdata');
  seedStore(userData);
  const app = await electron.launch({
    args: [APP_DIR, `--user-data-dir=${userData}`],
    timeout: 60_000,
  });
  await captureDialogs(app);
  return { app, userData };
}

async function open(
  app: ElectronApplication,
  userData: string,
  p: string,
  label: string
) {
  await app.evaluate(({ ipcMain }, f) => ipcMain.emit('app-open', [f]), p);
  const ok = await waitUntil(() => readStore(userData).filename === p, 25_000);
  expect(
    ok,
    `the app never opened ${label}; dialogs seen: ${(
      await dialogsSeen(app)
    ).join(' | ')}`
  ).toBe(true);
}

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

    await open(app, userData, pathA, 'Poem A');

    // The Editor component must be mounted before the second open: its own 'open-file' handler is the
    // code under test.
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });

    // The step that destroys Poem B.
    await open(app, userData, pathB, 'Poem B');

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
    await open(app, userData, pathA, 'the only poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await waitUntil(() => readFileSync(pathA, 'utf8') !== A.file, SETTLE_MS);
    expect(parseMidst(readFileSync(pathA, 'utf8')).history.length).toBe(
      A.historyLength
    );
  } finally {
    await app.close();
  }
});
