import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makePlayableMidst } from './fixtures';
import { launch, openDocument, waitUntil } from './harness';
import { readLog } from './log';

// A refused draft change is logged and the poet is told (Gitea #147), checked in the running app: the
// alert on screen, the line in the app's real log file, and the poem's file left as it was. The unit tests
// mock the bridge; this follows the message across it to main.log. Invented sentences only.

// More than 50 changes, so the button is not greyed out for being too short.
const SENTENCE =
  'the quick brown fox jumps over the lazy dog and then sleeps for a while';
const MARK = 'Mark this moment as a draft';
const REFUSED = 'draft marker change refused';
const UNREADABLE =
  'The drafts of this poem could not be read, so nothing was changed.';

test('a poem whose draft list is damaged: Mark is refused, said and logged, and the file is untouched', async () => {
  const doc = makePlayableMidst(SENTENCE);
  expect(doc.history.length).toBeGreaterThan(50);
  const work = mkdtempSync(join(tmpdir(), 'midst-refusal-'));
  const poemPath = join(work, 'damaged.midst');
  // The draft list is not a list: the marker code leaves it alone rather than overwrite it.
  const [header, body] = doc.file.split('\n');
  const damaged = `${header}\n${JSON.stringify({
    ...JSON.parse(body),
    meta: { draftMarkers: 'zq' },
  })}`;
  writeFileSync(poemPath, damaged);

  const logDir = join(work, 'logs');
  process.env.MIDST_LOG_DIR = logDir;
  const logFile = join(logDir, 'main.log');
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the damaged poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    const saved = readFileSync(poemPath, 'utf8');

    // CONTROL: nothing about drafts is logged before the poet acts, and the reader can read this log
    // (every line parses; the app has logged its own start-up by now).
    const before = readLog(logDir);
    expect(before.length).toBeGreaterThan(0);
    expect(before.map((r) => r.msg)).not.toContain(REFUSED);

    await win.getByRole('button', { name: MARK }).click();

    // The poet is told, and stays in the editor: a refused mark does not open the replay.
    await expect(win.getByRole('alert')).toHaveText(UNREADABLE);
    await expect(win.locator('.ProseMirror')).toBeVisible();

    // The app's own log has the fixed message and the reason, carried from the renderer to main.log.
    expect(
      await waitUntil(
        () => readLog(logDir).some((r) => r.msg === REFUSED),
        10_000
      ),
      'the refusal never reached main.log'
    ).toBe(true);
    const refusals = readLog(logDir).filter((r) => r.msg === REFUSED);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      level: 'error',
      source: 'renderer',
      msg: REFUSED,
      meta: { reason: 'markers-unreadable', action: 'create' },
    });
    // No words of the poem anywhere in the log.
    const logged = readFileSync(logFile, 'utf8');
    ['quick', 'brown', 'lazy', 'sleeps'].forEach((word) =>
      expect(logged).not.toContain(word)
    );

    // The damaged list is left exactly as it was.
    await win.waitForTimeout(2_000);
    expect(readFileSync(poemPath, 'utf8')).toBe(saved);
  } finally {
    await app.close();
    delete process.env.MIDST_LOG_DIR;
  }
});
