import { test, expect } from '@playwright/test';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import {
  SETTLE_MS,
  dialogsSeen,
  launch,
  openDocument,
  readStore,
} from './harness';

// Issue #14: the first open on a new profile warned of unsaved changes when nothing had been edited.
// `edited` had no value on a new profile, and only the string 'false' counted as "nothing to lose".
// The other specs seed that value; this one launches with NO seed, which is what a poet's first run
// of the app is.
//
// The harness's dialog stub records every message box and answers its first button, so before the
// fix this test does not hang: the open goes ahead and the warning is in the record.

test('the first open on a new profile does not warn of unsaved changes', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-'));
  const doc = makeMidst('FRESH-PROFILE-SENTINEL', 10);
  const file = join(work, 'poem.midst');
  writeFileSync(file, doc.file);

  // CONTROL -- the profile is new: nothing has written a store for it.
  expect(existsSync(join(work, 'userdata', 'config.json'))).toBe(false);

  const { app, userData } = await launch(work, { seed: false });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await openDocument(app, userData, file, 'the poem');

    // Do not close before the editor has mounted and its first save has been handled. On mounting,
    // the Editor sends 'save-file'; if the window's close handler has already cleared the stored
    // filename, save() asks for one with a native Save dialog that nothing here can answer, and the
    // run hangs in teardown (seen on the first version of this spec, which closed straight away).
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await new Promise((resolve) => {
      setTimeout(resolve, SETTLE_MS);
    });

    // CONTROL -- the open really happened, so an empty dialog record is not an app that did nothing.
    expect(readStore(userData).poem, 'the poem was not loaded').toContain(
      doc.sentinel
    );

    expect(await dialogsSeen(app), 'a dialog appeared on first open').toEqual(
      []
    );
  } finally {
    await app.close();
  }
});
