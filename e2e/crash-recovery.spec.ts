import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { coverageEnv } from './coverage';
import {
  APP_DIR,
  clickMenuItem,
  launch,
  readStore,
  SETTLE_MS,
  waitUntil,
} from './harness';

// An untitled poem survives Midst being killed (#315; Annelyse, GitHub #81). Nothing asks for a name while the poet
// types; autosave keeps a recovery copy; after a crash the next launch asks whether to recover it. Killed with
// SIGKILL, so no close handler or quit path runs: what is on disk is all the next launch has. Invented text only.

const TYPED = 'ZQXRECOVER';
const ANSWER_AT_LAUNCH = join(__dirname, 'answer-at-launch.cjs');

const recoveryCopies = (userData: string) => {
  const dir = join(userData, 'Recovery');
  return existsSync(dir)
    ? readdirSync(dir).filter((n) => /^[0-9a-f-]{36}\.midst$/.test(n))
    : [];
};

// New, type, wait for the recovery copy to hold the text, then kill Midst.
async function typeAndCrash(work: string) {
  const { app, userData } = await launch(work);
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await clickMenuItem(app, 'menu.file.new');
  const pm = win.locator('.ProseMirror');
  await expect(pm).toBeVisible({ timeout: 25_000 });
  await win.waitForTimeout(SETTLE_MS);
  await pm.click();
  await win.keyboard.type(TYPED);
  const written = await waitUntil(() => {
    const [copy] = recoveryCopies(userData);
    return (
      !!copy &&
      readFileSync(join(userData, 'Recovery', copy), 'utf8').includes(TYPED)
    );
  }, 15_000);
  expect(written, 'autosave wrote a recovery copy with the text').toBe(true);
  // CONTROL: no Save panel was asked for, and the poem has no file.
  expect(readStore(userData).filename ?? '').toBe('');
  // The owner file names this Midst so that another launch knows it is live: the start it recorded is the start ps
  // reports for it, within recovery.ts's 10 s.
  const [copy] = recoveryCopies(userData);
  const owner = JSON.parse(
    readFileSync(
      join(userData, 'Recovery', copy.replace(/\.midst$/, '.owner')),
      'utf8'
    )
  );
  const pid = app.process().pid!;
  expect(owner.pid).toBe(pid);
  const psStart = Date.parse(
    execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      env: { ...process.env, LC_ALL: 'C' },
    })
      .toString()
      .trim()
  );
  expect(Math.abs(psStart - owner.started)).toBeLessThan(10_000);
  app.process().kill('SIGKILL');
  await new Promise<void>((resolve) => {
    if (app.process().exitCode !== null) resolve();
    else app.process().once('exit', () => resolve());
  });
  return { userData, copy: recoveryCopies(userData)[0] };
}

async function relaunch(work: string, userData: string, answer: number) {
  const recordFile = join(work, `answered-${answer}.txt`);
  const app = await electron.launch({
    // Electron's own -r loads the answering script into the main process before the app's code.
    args: ['-r', ANSWER_AT_LAUNCH, APP_DIR, `--user-data-dir=${userData}`],
    env: {
      ...(coverageEnv() ?? (process.env as Record<string, string>)),
      MIDST_E2E_ANSWER: String(answer),
      MIDST_E2E_RECORD: recordFile,
    },
    timeout: 60_000,
  });
  const seen = () =>
    existsSync(recordFile)
      ? readFileSync(recordFile, 'utf8').split('\n').filter(Boolean)
      : [];
  return { app, seen };
}

test('after a crash, Yes brings the untitled poem back, still untitled', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-crash-'));
  const { userData, copy } = await typeAndCrash(work);
  const { app, seen } = await relaunch(work, userData, 0);
  try {
    expect(
      await waitUntil(
        () => seen().some((l) => l.startsWith('dialog ')),
        30_000
      ),
      'the next launch asks'
    ).toBe(true);
    expect(seen()).toEqual([
      'dialog Midst unexpectedly quit while you were working on the poem "Untitled." Would you like to recover your work?',
    ]);
    const win = await app.firstWindow();
    await expect(win.locator('.ProseMirror')).toContainText(TYPED, {
      timeout: 25_000,
    });
    const store = readStore(userData);
    expect(store.filename ?? '').toBe('');
    expect(store.edited).toBe('true');
    expect(`${store.recoveryId}.midst`).toBe(copy);
  } finally {
    await app.close();
  }
});

test('after a crash, No sends the copy to the Trash under a name that says what it is, and asks no more', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-crash-'));
  const { userData, copy } = await typeAndCrash(work);
  const before = statSync(join(userData, 'Recovery', copy)).size;
  const { app, seen } = await relaunch(work, userData, 1);
  try {
    expect(
      await waitUntil(() => seen().some((l) => l.startsWith('trash ')), 30_000),
      'declining sends the copy to the Trash'
    ).toBe(true);
    const trashed = seen()
      .find((l) => l.startsWith('trash '))!
      .slice('trash '.length);
    expect(trashed).toMatch(
      /Recovery[/\\]Untitled \(recovered \d{4}-\d\d-\d\d \d\d\.\d\d\)\.midst$/
    );
    // The stub leaves it where the Trash would have taken it from: the whole poem, under its new name.
    expect(statSync(trashed).size).toBe(before);
    expect(recoveryCopies(userData)).toEqual([]);
  } finally {
    await app.close();
  }
  // Declining cleared the crashed run's poem from the store, so closing asked nothing either.
  expect(seen().filter((l) => l.startsWith('dialog '))).toHaveLength(1);
  // A third launch has nothing to offer.
  const again = await relaunch(work, userData, 0);
  try {
    const win = await again.app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(SETTLE_MS);
    expect(again.seen()).toEqual([]);
  } finally {
    await again.app.close();
  }
});
