import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// Under Node, the electron package's export is the path to the Electron binary.
import electronBinary from 'electron';
import { makeMidst } from './fixtures';
import { APP_DIR, launch, readStore, waitUntil } from './harness';
import { readLog } from './log';

// One Midst at a time (#315; Stuart, 26 Oct). A second launch on the same profile, given a poem, quits by itself
// and the running copy opens the poem: double-clicking a poem in Finder or Explorer while Midst is open still opens
// it, and two copies never share one store.
test('a second launch hands its poem to the running copy and quits', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-'));
  const doc = makeMidst('SECOND-LAUNCH-SENTINEL', 10);
  const file = join(work, 'poem.midst');
  writeFileSync(file, doc.file);

  // The running copy logs which channel carried the poem (#336): on a failure, that says why.
  const logDir = join(work, 'logs');
  process.env.MIDST_LOG_DIR = logDir;
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    // CONTROL: the running copy has not opened the poem.
    expect(readStore(userData).filename ?? '').not.toBe(file);

    const second = spawn(
      electronBinary as unknown as string,
      [APP_DIR, `--user-data-dir=${userData}`, file],
      {
        stdio: 'ignore',
      }
    );
    const exited = new Promise<number | null>((resolve) => {
      second.on('exit', (code) => resolve(code));
    });
    const quitBy = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 30_000);
      }),
    ]);
    if (!quitBy) second.kill();
    expect(quitBy, 'the second launch quits by itself').toBe(true);

    const handed = () =>
      readLog(logDir).filter((r) => r.msg === 'second launch');
    expect(
      await waitUntil(() => handed().length > 0, 15_000),
      'the running copy heard the second launch'
    ).toBe(true);
    // The poem comes with the lock request, not from argv (Electron may change argv on Linux and Windows).
    expect(handed().map((r) => r.meta)).toEqual([
      expect.objectContaining({ poem: 'sent' }),
    ]);
    expect(
      await waitUntil(() => readStore(userData).filename === file, 15_000),
      `the running copy opens the poem; it logged ${JSON.stringify(handed())}`
    ).toBe(true);
    expect(app.windows()).toHaveLength(1);
  } finally {
    await app.close();
    delete process.env.MIDST_LOG_DIR;
  }
});
