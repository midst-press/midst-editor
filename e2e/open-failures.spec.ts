import { test, expect } from '@playwright/test';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MIDST_VERSION_HEADER } from './fixtures';
import { dialogsSeen, launch, readStore, waitUntil } from './harness';
import { readLog, type LogRecord } from './log';

// A poem that cannot be opened (#160), in the running app: the poet is told, main.log has one entry for it with
// what went wrong, and no word of the file's text is anywhere in main.log. The unit tests mock electron-log; this
// reads the real log file. Invented words only.

const WORDS = ['marigold', 'lantern', 'quiver'];

// Launches the app, asks it to open the file the way Finder does (main.ts emits app-open), and waits for the
// error dialog and the log entry. harness.openDocument waits for the file to be opened, which here it never is.
async function openFailing(work: string, poemPath: string) {
  const logDir = join(work, 'logs');
  process.env.MIDST_LOG_DIR = logDir;
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    // CONTROL: the reader can read this log (the app has logged its start-up), and nothing about opening yet.
    expect(
      await waitUntil(() => readLog(logDir).length > 0, 10_000),
      'the app wrote nothing to main.log'
    ).toBe(true);
    const isOpen = (r: LogRecord) => r.msg.startsWith('open:');
    expect(readLog(logDir).filter(isOpen)).toHaveLength(0);

    await app.evaluate(
      ({ ipcMain }, f) => ipcMain.emit('app-open', [f]),
      poemPath
    );
    await expect
      .poll(() => dialogsSeen(app), {
        message: 'the app showed no dialog',
        timeout: 25_000,
      })
      .not.toHaveLength(0);
    // The entry is written before the dialog is shown; the file may lag the call.
    expect(
      await waitUntil(() => readLog(logDir).some(isOpen), 10_000),
      'the failed open never reached main.log'
    ).toBe(true);
    return {
      seen: await dialogsSeen(app),
      opens: readLog(logDir).filter(isOpen),
      logged: readFileSync(join(logDir, 'main.log'), 'utf8'),
      openedFile: readStore(userData).filename ?? '',
    };
  } finally {
    await app.close();
    delete process.env.MIDST_LOG_DIR;
  }
}

test('a file that cannot be read: the poet is told, and main.log says why', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-open-unreadable-'));
  const poemPath = join(work, 'unreadable.midst');
  writeFileSync(
    poemPath,
    `${MIDST_VERSION_HEADER}\n{"text": "<p>${WORDS.join(' ')}</p>"}`
  );
  chmodSync(poemPath, 0o000);
  try {
    // CONTROL: unreadable to this user, or the test proves nothing (root reads it anyway).
    expect(() => readFileSync(poemPath)).toThrow(/EACCES/);
    const { seen, opens, logged, openedFile } = await openFailing(
      work,
      poemPath
    );

    expect(seen).toHaveLength(1);
    expect(
      seen[0].startsWith(`The file ${poemPath} could not be opened: EACCES`)
    ).toBe(true);
    expect(opens).toEqual([
      expect.objectContaining({
        level: 'error',
        source: 'main',
        msg: 'open: the file could not be read',
        meta: { filePath: poemPath, code: 'EACCES' },
      }),
    ]);
    expect(openedFile).not.toBe(poemPath);
    WORDS.forEach((word) => expect(logged).not.toContain(word));
  } finally {
    chmodSync(poemPath, 0o644);
  }
});

test('a corrupt file: the poet is told, and main.log has the error by name, never its message', async () => {
  // The version line is right, so the app tries to load it, and the JSON is not.
  const body = `{"text": ${WORDS.join(' ')}}`;
  // CONTROL: the parse error's own message quotes the poem, so logging the message would leak it.
  expect(() => JSON.parse(body)).toThrow(new RegExp(WORDS[0]));
  const work = mkdtempSync(join(tmpdir(), 'midst-open-corrupt-'));
  const poemPath = join(work, 'corrupt.midst');
  writeFileSync(poemPath, `${MIDST_VERSION_HEADER}\n${body}`);
  const { seen, opens, logged, openedFile } = await openFailing(work, poemPath);

  expect(seen).toEqual([
    `The file ${poemPath} could not be opened. File may be corrupted. Please select another file and try again.`,
  ]);
  expect(opens).toHaveLength(1);
  expect(opens[0]).toMatchObject({
    level: 'error',
    source: 'main',
    msg: 'open: the file could not be loaded',
    meta: { filePath: poemPath, name: 'SyntaxError' },
  });
  expect(
    (opens[0].meta as { frames: unknown[] }).frames.length
  ).toBeGreaterThan(0);
  expect(openedFile).not.toBe(poemPath);
  WORDS.forEach((word) => expect(logged).not.toContain(word));
});
