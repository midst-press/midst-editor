// Shared Electron harness for the end-to-end specs. Extracted so the open-sequence and playback
// specs use ONE copy of this; duplicated test helpers drift, and these encode hard-won facts about
// how this app has to be driven.

import { expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { collectCoverage, coverageEnv } from './coverage';

export const APP_DIR = resolvePath(__dirname, '..', 'release', 'app');

// Long enough that a RED run reproduces an overwrite inside it, which is what establishes the window
// is adequate. A green run pays it in full, once per test.
export const SETTLE_MS = 5_000;

// electron-store writes <userData>/config.json. Read it from disk rather than reaching into the
// app's module graph: the file is the artifact the app actually relies on.
export function readStore(userData: string): Record<string, string> {
  const p = join(userData, 'config.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

// `handleUnsavedChanges` (menu.ts:21) returns early ONLY when store.edited is the string 'false'. On
// a brand-new profile it is undefined, so the first open puts up a modal `showMessageBoxSync`, which
// blocks Electron's main process with nobody to click it -- the app hangs rather than opening
// anything. Seeding 'false' puts the app in the state a returning user is actually in.
// The app now defaults `edited` to 'false' itself (src/main/store.ts), and fresh-profile.spec.ts
// launches with no seed to hold it to that. The seed stays for the other specs, so that what they
// start from is written down here and does not depend on that default.
export function seedStore(userData: string) {
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, 'config.json'),
    JSON.stringify({ edited: 'false' })
  );
}

// Make any remaining modal OBSERVABLE instead of fatal. A blocking dialog is indistinguishable from
// a deadlock from outside, so record them and let the test report what appeared.
export async function captureDialogs(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { capturedDialogs?: string[] };
    g.capturedDialogs = [];
    dialog.showMessageBoxSync = ((_w: unknown, opts: { message?: string }) => {
      g.capturedDialogs!.push(opts?.message ?? '(no message)');
      return 0; // 'Proceed', chosen deliberately: the app's own default is Cancel
    }) as typeof dialog.showMessageBoxSync;
  });
}

export async function dialogsSeen(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () =>
      (globalThis as unknown as { capturedDialogs?: string[] })
        .capturedDialogs ?? []
  );
}

// setInterval rather than awaiting inside a loop. The predicate is synchronous -- it reads a file --
// so polling needs no await at all, which satisfies no-await-in-loop by not doing the thing rather
// than by suppressing the complaint about it.
export function waitUntil(pred: () => boolean, ms: number): Promise<boolean> {
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

// WHY global-setup copies a preload: main.ts:107 picks the preload path on app.isPackaged, which is
// false for a built-but-unpackaged launch, so it looks for a dev preload `npm run build` never
// creates. Without it window.electron is undefined and React never mounts.
export async function launch(
  work: string,
  { seed = true }: { seed?: boolean } = {}
) {
  const userData = join(work, 'userdata');
  if (seed) seedStore(userData);
  const app = await electron.launch({
    args: [APP_DIR, `--user-data-dir=${userData}`],
    env: coverageEnv(),
    timeout: 60_000,
  });
  await captureDialogs(app);
  await collectCoverage(app);
  return { app, userData };
}

// Drives the OS "open this document" path -- main.ts:308 emits this internally when the OS asks the
// app to open a file, which is the Finder double-click a poet actually performs. No native dialog
// has to be clicked.
export async function openDocument(
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
