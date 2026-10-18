import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ChangeObj, reconstruct } from '@midst-press/midst-format/history';
import { makePlayableMidst } from './fixtures';
import { launch, openDocument, readStore, waitUntil } from './harness';

// Restart from here (GitHub #18), checked in the FILE, because the file is what the poet keeps (Cora on
// midst-editor #156). The unit tests mock the store and navigation; here the real Editor mounts after the
// restart, saves, and records the next keystroke. Invented sentences only.

const SENTENCE = 'the quick brown fox jumps over the lazy dog';
const MID = 20; // a middle frame: neither the first nor the last

const onDisk = (path: string): { text: string; history: ChangeObj[] } =>
  JSON.parse(readFileSync(path, 'utf8').split('\n').slice(1).join('\n'));

// Replay's slider to frame `index`, one key at a time from the first frame.
async function goToFrame(win: Page, index: number) {
  const thumb = win.locator('.MuiSlider-thumb input');
  await thumb.focus();
  await thumb.press('Home');
  for (let i = 0; i < index; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await thumb.press('ArrowRight');
  }
  await expect(thumb).toHaveValue(String(index));
}

// The whole check, from a poem open in the editor to the same poem reopened.
async function restartAndCheck(
  app: ElectronApplication,
  win: Page,
  poemPath: string,
  work: string
) {
  const before = onDisk(poemPath);
  const n = before.history.length;
  expect(n, 'the poem needs a middle frame').toBeGreaterThan(MID + 1);
  // CONTROL: the file replays to its own text, as the integrity check will require.
  expect(reconstruct('', before.history, n - 1)).toBe(before.text);
  const chosen = reconstruct('', before.history, MID);
  expect(chosen).not.toBe(before.text);

  await win.getByRole('link', { name: 'Replay' }).click();
  await expect(win.locator('.ReplayContainer')).toBeVisible({
    timeout: 25_000,
  });
  await goToFrame(win, MID);
  await win.getByRole('button', { name: 'Restart from here' }).click();

  // 1. The editor shows the chosen frame's text.
  const editor = win.locator('.ProseMirror');
  await expect(editor, 'the poet was not taken back to writing').toBeVisible({
    timeout: 25_000,
  });
  await expect(win.getByRole('alert')).toHaveCount(0);
  expect(await editor.innerHTML()).toBe(chosen);

  // 2. The file has exactly one more change, every earlier frame unchanged, and it replays to the chosen text.
  expect(
    await waitUntil(() => onDisk(poemPath).history.length === n + 1, 10_000),
    'the restart never reached the file'
  ).toBe(true);
  const after = onDisk(poemPath);
  expect(after.history.slice(0, n)).toEqual(before.history);
  expect(after.text).toBe(chosen);
  expect(reconstruct('', after.history, n)).toBe(chosen);

  // 3. The mount does not append a second change: still n + 1 after longer than the autosave delay.
  await win.waitForTimeout(2_500);
  expect(onDisk(poemPath).history.length).toBe(n + 1);

  // ...and the first keystroke appends exactly one, recorded against the restarted text.
  await editor.click();
  await win.keyboard.press('End');
  await win.keyboard.type('z');
  expect(
    await waitUntil(() => onDisk(poemPath).history.length === n + 2, 10_000),
    'the keystroke after the restart never reached the file'
  ).toBe(true);
  await win.waitForTimeout(2_500);
  const typed = onDisk(poemPath);
  expect(typed.history.length).toBe(n + 2);
  expect(typed.history.slice(0, n + 1)).toEqual(after.history);
  expect(reconstruct('', typed.history, n + 1)).toBe(typed.text);
  expect(typed.text).not.toBe(chosen);

  // 4. Reopened in a fresh app, the poem is the same.
  await app.close();
  const again = await launch(work);
  try {
    const win2 = await again.app.firstWindow();
    await win2.waitForLoadState('domcontentloaded');
    await openDocument(
      again.app,
      again.userData,
      poemPath,
      'the restarted poem'
    );
    await expect(win2.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    expect(await win2.locator('.ProseMirror').innerHTML()).toBe(typed.text);
    expect(readStore(again.userData).history).toBe(
      JSON.stringify(typed.history)
    );
  } finally {
    await again.app.close();
  }
}

test('restart from a middle frame of a poem recorded by the app', async () => {
  const doc = makePlayableMidst(SENTENCE);
  const work = mkdtempSync(join(tmpdir(), 'midst-restart-'));
  const poemPath = join(work, 'recorded.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await openDocument(app, userData, poemPath, 'the recorded poem');
  await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
  await restartAndCheck(app, win, poemPath, work);
});

// An older Midst file: frames of whole HTML, no version line. Opening it offers to convert it, and the
// app writes <name>-converted.midst beside it and opens that. This is the path Annelyse's older poems take.
test('restart from a middle frame of a poem converted from an older file', async () => {
  const T0 = 1605903809127;
  const frames = Array.from({ length: SENTENCE.length }, (_, i) => ({
    content: `<p>${SENTENCE.slice(0, i + 1)}</p>`,
    lineNumber: '0',
    timestamp: T0 + i * 100,
  }));
  const work = mkdtempSync(join(tmpdir(), 'midst-restart-old-'));
  const oldPath = join(work, 'older.midst');
  writeFileSync(oldPath, JSON.stringify({ editorTimelineFrames: frames }));
  const convertedPath = join(work, 'older-converted.midst');

  const { app, userData } = await launch(work);
  // Answer the version prompt with Convert File (button 1); any other dialog keeps the harness's answer.
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBoxSync;
    dialog.showMessageBoxSync = ((w: unknown, opts: { message?: string }) =>
      opts?.message?.includes('Version not recognized')
        ? 1
        : (Reflect.apply(original, dialog, [
            w,
            opts,
          ]) as number)) as typeof dialog.showMessageBoxSync;
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await app.evaluate(
    ({ ipcMain }, f) => ipcMain.emit('app-open', [f]),
    oldPath
  );
  expect(
    await waitUntil(
      () => readStore(userData).filename === convertedPath,
      25_000
    ),
    'the older file was not converted and opened'
  ).toBe(true);
  await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
  await restartAndCheck(app, win, convertedPath, work);
});
