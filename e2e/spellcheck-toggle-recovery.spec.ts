import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { coverageEnv } from './coverage';
import {
  APP_DIR,
  clickCheckSpelling,
  clickMenuItem,
  readStore,
  seedStore,
  SETTLE_MS,
  waitUntil,
} from './harness';

// Turning spellcheck on or off reloads the window (editor #238, case 5). In 0.10.0 Annelyse saw the crash-recovery
// offer every time she did it, with an untitled poem open (GitHub #71, editor #460). Nothing crashed, so nothing may
// be offered, and the poem must be there after the reload whatever the poet answers. A synthetic profile and invented
// text only. Every dialog is answered and recorded by answer-at-launch.cjs, which also keeps the real Trash untouched.

const TYPED = 'ZQXTOGGLE';
const ANSWER_AT_LAUNCH = join(__dirname, 'answer-at-launch.cjs');

const recoveryCopies = (userData: string) => {
  const dir = join(userData, 'Recovery');
  return existsSync(dir)
    ? readdirSync(dir).filter((n) => /^[0-9a-f-]{36}\.midst$/.test(n))
    : [];
};

// Midst on `userData`, with every dialog answered `answer` (0 Yes, 1 No) and recorded.
async function start(work: string, userData: string, answer: number) {
  const record = join(work, `answered-${answer}-${Date.now()}.txt`);
  const app = await electron.launch({
    args: ['-r', ANSWER_AT_LAUNCH, APP_DIR, `--user-data-dir=${userData}`],
    env: {
      ...(coverageEnv() ?? (process.env as Record<string, string>)),
      MIDST_E2E_ANSWER: String(answer),
      MIDST_E2E_RECORD: record,
    },
    timeout: 60_000,
  });
  const seen = () =>
    existsSync(record)
      ? readFileSync(record, 'utf8').split('\n').filter(Boolean)
      : [];
  return { app, seen };
}

// A new untitled poem with text in it, and its recovery copy written.
async function untitledPoemWithText(answer: number) {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-toggle-'));
  const userData = join(work, 'userdata');
  seedStore(userData);
  const { app, seen } = await start(work, userData, answer);
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await clickMenuItem(app, 'menu.file.new');
  const pm = win.locator('.ProseMirror');
  await expect(pm).toBeVisible({ timeout: 25_000 });
  await win.waitForTimeout(SETTLE_MS);
  await pm.click();
  await win.keyboard.type(TYPED);
  // CONTROL: autosave kept the untitled poem's recovery copy, which is what a reload could offer.
  const written = await waitUntil(() => {
    const [copy] = recoveryCopies(userData);
    return (
      !!copy &&
      readFileSync(join(userData, 'Recovery', copy), 'utf8').includes(TYPED)
    );
  }, 15_000);
  expect(written, 'autosave wrote a recovery copy with the text').toBe(true);
  // CONTROL: nothing was asked before the toggle.
  expect(seen().filter((l) => l.startsWith('dialog '))).toEqual([]);
  return { app, win, work, userData, seen };
}

type Started = Awaited<ReturnType<typeof untitledPoemWithText>>;

// Ends Midst without its quit path. The poem is unsaved, so a close asks about it, and every dialog here gets the same
// answer, which for No cancels the quit and leaves app.close() waiting for ever (run 14191).
async function end(app: Started['app']) {
  const exited = new Promise<void>((resolve) => {
    if (app.process().exitCode !== null) resolve();
    else app.process().once('exit', () => resolve());
  });
  app.process().kill('SIGKILL');
  await exited;
}

// Check Spelling, then wait past the reloaded page's first render, when main's ready-to-show handler would offer.
async function toggle({ app, win, userData }: Started) {
  await clickCheckSpelling(app);
  expect(
    await waitUntil(() => readStore(userData).spellcheck === 'true', 10_000)
  ).toBe(true);
  await expect(win.locator('.ProseMirror')).toHaveAttribute(
    'spellcheck',
    'true',
    { timeout: 25_000 }
  );
  await win.waitForTimeout(SETTLE_MS);
}

[
  { answer: 1, label: 'No' },
  { answer: 0, label: 'Yes' },
].forEach(({ answer, label }) => {
  test(`turning spellcheck on keeps an untitled poem, and offers no recovery (dialog answered ${label})`, async () => {
    const started = await untitledPoemWithText(answer);
    const { app, win, userData, seen } = started;
    try {
      await toggle(started);
      const shown = (await win.locator('.ProseMirror').textContent()) ?? '';
      const store = readStore(userData);
      const facts = JSON.stringify({
        seen: seen(),
        editorHasText: shown.includes(TYPED),
        storeHasText: String(store.poem ?? '').includes(TYPED),
        filename: store.filename ?? '',
        recoveryCopies: recoveryCopies(userData).length,
      });
      // The poem first: that it survives matters more than that nothing was asked.
      expect(shown.includes(TYPED), `the poem after the reload: ${facts}`).toBe(
        true
      );
      // And through a second reload, which takes the poem from the store: after an answer that cleared the store, the
      // editor's copy is the only one left.
      await clickCheckSpelling(app);
      expect(
        await waitUntil(
          () => readStore(userData).spellcheck === 'false',
          10_000
        )
      ).toBe(true);
      await expect(win.locator('.ProseMirror')).toHaveAttribute(
        'spellcheck',
        'false',
        { timeout: 25_000 }
      );
      await win.waitForTimeout(SETTLE_MS);
      const shownAgain =
        (await win.locator('.ProseMirror').textContent()) ?? '';
      expect(
        shownAgain.includes(TYPED),
        `the poem after a second reload: ${JSON.stringify({
          seen: seen(),
          storeHasText: String(readStore(userData).poem ?? '').includes(TYPED),
          edited: readStore(userData).edited,
          recoveryCopies: recoveryCopies(userData).length,
        })}`
      ).toBe(true);
      expect(
        seen(),
        `nothing crashed, so nothing is asked or trashed: ${facts}`
      ).toEqual([]);
    } finally {
      await end(app);
    }
  });
});

// Violet's question on #460: after Yes, is the poem the latest typing, or the older copy the offer names? Text typed
// just before the toggle, with no time for autosave to write the recovery copy again.
test('after Yes on the toggle offer, the poem is the latest typing, not the older recovery copy', async () => {
  const started = await untitledPoemWithText(0);
  const { app, win, userData, seen } = started;
  try {
    const LATER = 'QZXLATER';
    await win.keyboard.type(` ${LATER}`);
    const [copy] = recoveryCopies(userData);
    const copyHadLater = readFileSync(
      join(userData, 'Recovery', copy),
      'utf8'
    ).includes(LATER);
    await toggle(started);
    const shown = (await win.locator('.ProseMirror').textContent()) ?? '';
    const facts = JSON.stringify({
      seen: seen(),
      copyHadLaterAtToggle: copyHadLater,
      editorHasEarlier: shown.includes(TYPED),
      editorHasLater: shown.includes(LATER),
      storeHasLater: String(readStore(userData).poem ?? '').includes(LATER),
    });
    expect(shown.includes(LATER), `the latest typing after Yes: ${facts}`).toBe(
      true
    );
  } finally {
    await end(app);
  }
});

// Violet's question on #460: what quitting Midst with the offer open does. A native modal cannot be left open in a
// test, so this is the case a test can reach: Midst ends (killed, as a force quit or a crash would) while the offer is
// up. The next launch must still have the poem.
test('Midst ending while the toggle offer is up still leaves the poem for the next launch', async () => {
  const started = await untitledPoemWithText(0);
  const { app, work, userData } = started;
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = (() => {
      process.kill(process.pid, 'SIGKILL');
      return 0;
    }) as typeof dialog.showMessageBoxSync;
  });
  const ended = new Promise<void>((resolve) => {
    if (app.process().exitCode !== null) resolve();
    else app.process().once('exit', () => resolve());
  });
  await clickCheckSpelling(app).catch(() => {});
  // If no offer comes, nothing kills it: then end it here, as a quit with nothing asked.
  const killedByOffer = await Promise.race([
    ended.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 30_000);
    }),
  ]);
  if (!killedByOffer) {
    await end(app);
  }
  const again = await start(work, userData, 0);
  try {
    const win = await again.app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(SETTLE_MS);
    const store = readStore(userData);
    const shown =
      (await win
        .locator('.ProseMirror')
        .textContent()
        .catch(() => '')) ?? '';
    const facts = JSON.stringify({
      killedByOffer,
      seenOnRelaunch: again.seen(),
      editorHasText: shown.includes(TYPED),
      storeHasText: String(store.poem ?? '').includes(TYPED),
      recoveryCopies: recoveryCopies(userData).length,
    });
    expect(shown.includes(TYPED), `the poem on the next launch: ${facts}`).toBe(
      true
    );
  } finally {
    await again.app.close();
  }
});
