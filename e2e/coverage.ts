// V8 coverage collector for the e2e specs (midst-editor#29). Active only under COVERAGE=1, against a
// COVERAGE=1 build (whose source maps name src/... files on disk). Writes raw V8 coverage, in the
// NODE_V8_COVERAGE file format, to coverage/e2e/v8/; scripts/coverage-merge.mjs turns it into istanbul
// JSON with c8 and merges it with Jest's.
//
//   main process  NODE_V8_COVERAGE, written by Node itself when the app exits.
//   window        CDP precise coverage. Started, then the window is RELOADED, so that module top-level
//                 code runs while coverage is on; without the reload everything that ran at startup
//                 would read as never run.
//   preload       not collected: it runs in an isolated world neither path reaches.
//
// A test that dies before close() contributes nothing, so this can under-count, never over-count.

import type { ElectronApplication, Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

export const COVERAGE = process.env.COVERAGE === '1';
export const V8_DIR = resolve(__dirname, '..', 'coverage', 'e2e', 'v8');

let written = 0;

/** The environment to launch Electron with: the caller's, plus NODE_V8_COVERAGE under COVERAGE=1. */
export function coverageEnv(
  env: Record<string, string | undefined> = process.env
): Record<string, string> | undefined {
  if (!COVERAGE) return undefined;
  mkdirSync(V8_DIR, { recursive: true });
  return { ...(env as Record<string, string>), NODE_V8_COVERAGE: V8_DIR };
}

/**
 * Start precise coverage in the app's first window and reload it; on app.close(), write what the
 * window ran before closing. No-op unless COVERAGE=1.
 */
export async function collectCoverage(app: ElectronApplication) {
  if (!COVERAGE) return;
  const win: Page = await app.firstWindow();
  const cdp = await app.context().newCDPSession(win);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.startPreciseCoverage', {
    callCount: true,
    detailed: true,
  });
  await win.reload();
  await win.waitForLoadState('load');

  const close = app.close.bind(app);
  app.close = async () => {
    const { result } = await cdp.send('Profiler.takePreciseCoverage');
    // Only the app's own bundle: file:// URLs under release/app/dist.
    const ours = result.filter(
      (r) => r.url.startsWith('file://') && r.url.includes('/release/app/dist/')
    );
    mkdirSync(V8_DIR, { recursive: true });
    written += 1;
    writeFileSync(
      join(V8_DIR, `coverage-window-${process.pid}-${written}.json`),
      JSON.stringify({ result: ours })
    );
    return close();
  };
}
