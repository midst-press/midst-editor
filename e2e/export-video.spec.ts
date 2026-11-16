import { test, expect } from '@playwright/test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import { waitUntil, launch, openDocument } from './harness';

// File > Export as Video… (#506): the open poem's writing, played into an MP4 file by a hidden window, with the
// poet told when it is ready. Nonsense strings throughout: no poem content belongs in this repository.

const clickMenu = async (
  app: Awaited<ReturnType<typeof launch>>['app'],
  label: string
) =>
  app.evaluate(({ Menu }, wanted) => {
    type Item = Electron.MenuItem;
    const find = (items: Item[]): Item | undefined => {
      const here = items.find((i) => i.label === wanted);
      if (here) return here;
      return items
        .map((i) => (i.submenu ? find(i.submenu.items) : undefined))
        .find(Boolean);
    };
    const item = find(Menu.getApplicationMenu()?.items ?? []);
    if (!item) throw new Error(`no ${wanted} item`);
    if (!item.enabled) throw new Error(`${wanted} is disabled`);
    item.click();
  }, label);

test('Export as Video… writes an MP4 of the poem and says it is ready', async () => {
  test.setTimeout(180_000);
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-video-'));
  const doc = makeMidst('VIDEO-SENTINEL', 10);
  const poemPath = join(work, 'video.midst');
  const videoPath = join(work, 'video.mp4');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });

    // The poet cancels the save dialog: nothing is written and nothing is said.
    await app.evaluate(({ dialog }) => {
      // An empty name is what showSaveDialogSync gives when cancelled.
      dialog.showSaveDialogSync = (() =>
        '') as typeof dialog.showSaveDialogSync;
      (globalThis as { videoBoxes?: string[] }).videoBoxes = [];
      dialog.showMessageBox = ((
        _w: unknown,
        opts: Electron.MessageBoxOptions
      ) => {
        (globalThis as { videoBoxes?: string[] }).videoBoxes?.push(
          opts.message
        );
        return Promise.resolve({ response: 1, checkboxChecked: false });
      }) as typeof dialog.showMessageBox;
    });
    await clickMenu(app, 'Export as Video…');
    await win.waitForTimeout(1_000);
    expect(readdirSync(work).filter((f) => f.endsWith('.mp4'))).toEqual([]);

    // Then chooses a file.
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialogSync = (() => p) as typeof dialog.showSaveDialogSync;
    }, videoPath);
    await clickMenu(app, 'Export as Video…');
    expect(
      await waitUntil(() => existsSync(videoPath), 150_000),
      'no video was written'
    ).toBe(true);

    const bytes = readFileSync(videoPath);
    // An MP4 begins with its ftyp box; with the index at the front (fastStart), moov comes before mdat.
    expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
    const moov = bytes.indexOf('moov');
    const mdat = bytes.indexOf('mdat');
    expect(moov).toBeGreaterThan(0);
    expect(mdat).toBeGreaterThan(moov);
    expect(bytes.length).toBeGreaterThan(10_000);
    // No scratch folder or partial file left beside it.
    expect(
      readdirSync(work).filter(
        (f) => f.startsWith('.midst-export-') || f.includes('.partial')
      )
    ).toEqual([]);

    // The poet is told, and the item can be used again.
    await expect
      .poll(
        () =>
          app.evaluate(
            () =>
              ((globalThis as { videoBoxes?: string[] }).videoBoxes ?? [])
                .length
          ),
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0);
    const boxes = await app.evaluate(
      () => (globalThis as { videoBoxes?: string[] }).videoBoxes ?? []
    );
    expect(boxes).toEqual(['The video is ready.']);
    const enabled = await app.evaluate(
      ({ Menu }) =>
        Menu.getApplicationMenu()?.getMenuItemById('menu.file.exportVideo')
          ?.enabled
    );
    expect(enabled).toBe(true);
  } finally {
    await app.close();
  }
});
