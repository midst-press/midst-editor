import { test, expect } from '@playwright/test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { makeMidst } from './fixtures';
import {
  dialogsSeen,
  launch,
  openDocument,
  SETTLE_MS,
  waitUntil,
} from './harness';
import { readLog } from './log';

// A save that fails (#160), in the running app: the poem's folder is made read-only after it is opened, so the
// next save cannot write. The poet is told, main.log has the failure and its reason, the poem's file is left as
// it was, and none of the poem's words are anywhere in main.log. Invented words only.

const SENTINEL = 'marigold';
const TYPED = ' lantern quiver';
const NOT_WRITTEN = 'save: the document was not written';

test('a save into a read-only folder: the poet is told, main.log says why, and the file is untouched', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-save-failure-'));
  const folder = join(work, 'poems');
  mkdirSync(folder);
  const poemPath = join(folder, 'readonly.midst');
  writeFileSync(poemPath, makeMidst(SENTINEL, 0).file);

  const logDir = join(work, 'logs');
  process.env.MIDST_LOG_DIR = logDir;
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    // Save As… is what the poet is offered; here it is cancelled, so no native dialog is left open.
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialogSync = (() =>
        undefined) as unknown as typeof dialog.showSaveDialogSync;
    });
    await openDocument(app, userData, poemPath, 'the poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await win.waitForTimeout(SETTLE_MS);
    const saved = readFileSync(poemPath, 'utf8');

    chmodSync(folder, 0o555);
    // CONTROL: this user cannot create a file in the folder, or the test proves nothing (root can).
    expect(() => writeFileSync(join(folder, 'probe'), '')).toThrow(/EACCES/);
    // CONTROL: the log is readable and has no failed save yet, and no dialog has been shown.
    expect(readLog(logDir).length).toBeGreaterThan(0);
    expect(readLog(logDir).map((r) => r.msg)).not.toContain(NOT_WRITTEN);
    expect(await dialogsSeen(app)).toEqual([]);

    await win.locator('.ProseMirror').click();
    await win.keyboard.press('End');
    await win.keyboard.type(TYPED, { delay: 20 });

    // The autosave fails, and the poet is told once.
    await expect
      .poll(() => dialogsSeen(app), {
        message: 'the poet was never told the save failed',
        timeout: 25_000,
      })
      .toEqual([`Midst could not save "${basename(poemPath)}".`]);

    expect(
      await waitUntil(
        () => readLog(logDir).some((r) => r.msg === NOT_WRITTEN),
        10_000
      ),
      'the failed save never reached main.log'
    ).toBe(true);
    const failures = readLog(logDir).filter((r) => r.msg === NOT_WRITTEN);
    expect(failures.length).toBeGreaterThan(0);
    failures.forEach((f) => {
      expect(f).toMatchObject({
        level: 'error',
        source: 'main',
        meta: { filename: poemPath },
      });
      expect((f.meta as { reason: string }).reason).toMatch(/^EACCES/);
    });

    // The poem's file is as it was, and no word of the poem is in the log.
    expect(readFileSync(poemPath, 'utf8')).toBe(saved);
    const logged = readFileSync(join(logDir, 'main.log'), 'utf8');
    [SENTINEL, 'lantern', 'quiver'].forEach((word) =>
      expect(logged).not.toContain(word)
    );
  } finally {
    chmodSync(folder, 0o755);
    await app.close();
    delete process.env.MIDST_LOG_DIR;
  }
});
