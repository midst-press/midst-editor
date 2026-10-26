import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMidst } from './fixtures';
import {
  clickMenuItem,
  launch,
  openDocument,
  readStore,
  waitUntil,
} from './harness';

// #125. The window title is set in one place (src/renderer/WindowTitle.tsx). This pins the title at each step a poet takes: launch, New, Open, Save As and back to the opening
// screen. Three readings each: the title bar the app draws, the page's document.title (which the title
// bar library sets with it), and the native window title, which the Window menu and the OS show.

type Titles = { drawn: string; doc: string; native: string };

async function titles(app: ElectronApplication, win: Page): Promise<Titles> {
  const page = await win.evaluate(() => ({
    drawn:
      (document.querySelector('.cet-title') as HTMLElement | null)?.innerText ??
      '(no title element)',
    doc: document.title,
  }));
  const native = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getTitle()
  );
  return { ...page, native };
}

// The save dialog answers from a queue the test fills: a path, or undefined for Cancel. An empty queue
// fails the call loudly rather than answering for the test.
async function answerSaveDialogs(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { saveAnswers?: (string | undefined)[] };
    g.saveAnswers = [];
    dialog.showSaveDialogSync = (() => {
      if (g.saveAnswers!.length === 0)
        throw new Error('save dialog answer not set by this test');
      return g.saveAnswers!.shift();
    }) as unknown as typeof dialog.showSaveDialogSync;
  });
}

async function nextSaveAnswer(
  app: ElectronApplication,
  answer: string | undefined
) {
  await app.evaluate((_e, a) => {
    (
      globalThis as unknown as { saveAnswers: (string | undefined)[] }
    ).saveAnswers.push(a ?? undefined);
  }, answer ?? null);
}

async function newFile(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.emit('new-file', {});
  });
}

async function settled(
  app: ElectronApplication,
  win: Page,
  expected: Titles,
  step: string
) {
  await expect
    .poll(() => titles(app, win), { message: step, timeout: 15_000 })
    .toEqual(expected);
}

// On the opening screen the drawn title and document.title are empty, and the native title is Midst rather than
// Electron's fallback to the page's file name, index.html (#194).
const OPENING_SCREEN: Titles = { drawn: '', doc: '', native: 'Midst' };

test('the window title at launch, New, Save, Open, Save As and New again', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-e2e-title-'));
  const B = makeMidst('POEM-TITLE-B-SENTINEL', 3);
  const pathB = join(work, 'title-b.midst');
  writeFileSync(pathB, B.file);
  const pathNew = join(work, 'title-new.midst');
  const pathAs = join(work, 'title-as.midst');

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await answerSaveDialogs(app);
    const landing = win.getByText('New File...');
    await expect(landing).toBeVisible({ timeout: 25_000 });

    // Launch, onto the opening screen.
    await settled(app, win, OPENING_SCREEN, 'launch');

    // New: the editor opens on an Untitled poem, and nothing asks where to save it (#315). A save dialog here would
    // fail the test, since none is queued.
    await newFile(app);
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 15_000 });
    await settled(
      app,
      win,
      { drawn: 'Untitled', doc: 'Untitled', native: 'Untitled' },
      'New'
    );

    // Save, under a name.
    await nextSaveAnswer(app, pathNew);
    await clickMenuItem(app, 'menu.file.save');
    expect(
      await waitUntil(() => readStore(userData).filename === pathNew, 15_000),
      'New was not saved'
    ).toBe(true);
    await settled(
      app,
      win,
      {
        drawn: 'title-new.midst',
        doc: 'title-new.midst',
        native: 'title-new.midst',
      },
      'New, saved'
    );

    // Open another poem.
    await openDocument(app, userData, pathB, 'poem B');
    await settled(
      app,
      win,
      // Before #125 the native title here was the full path: the autosave on open set it from main, and
      // nothing replaced it. It now follows the drawn title, as at every other step.
      { drawn: 'title-b.midst', doc: 'title-b.midst', native: 'title-b.midst' },
      'Open'
    );

    // Save As under another name.
    await nextSaveAnswer(app, pathAs);
    await clickMenuItem(app, 'menu.file.saveAs');
    expect(
      await waitUntil(() => readStore(userData).filename === pathAs, 15_000),
      'Save As did not record the new name'
    ).toBe(true);
    await settled(
      app,
      win,
      {
        drawn: 'title-as.midst',
        doc: 'title-as.midst',
        native: 'title-as.midst',
      },
      'Save As'
    );

    // New while a poem is open: Untitled, with nothing left of the last poem's name.
    await newFile(app);
    await settled(
      app,
      win,
      { drawn: 'Untitled', doc: 'Untitled', native: 'Untitled' },
      'New from a poem'
    );
  } finally {
    await app.close();
  }
});
