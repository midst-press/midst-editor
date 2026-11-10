import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';

// View > Colours…: saving a colour set to a text file and reading one back (GitHub #119). The dialogs live here, in
// main, so their filters and the refusals below are enforced where the file is touched. A colour set is never a
// poem: a .midst path is refused both ways, so this can neither write over a poem nor try to read one. No words live
// here: a refusal is a code, and the renderer's English-only audition panel says it, so main holds nothing that belongs
// in the message catalog.

export type ColourFileFailure =
  | 'cancelled'
  | 'poem'
  | 'tooLarge'
  | 'unwritable'
  | 'unreadable'
  | 'unavailable';

export type ColourFileResult =
  | { ok: true; text?: string; path: string }
  | { ok: false; failure: ColourFileFailure; error?: string };

// A colour set is a few kilobytes; anything far larger is not one.
export const MAX_IMPORT_BYTES = 64 * 1024;

const isPoem = (path: string) => path.toLowerCase().endsWith('.midst');

export interface ColourFileDeps {
  // eslint-disable-next-line no-unused-vars -- parameters named in function types
  save: () => string | undefined;
  // eslint-disable-next-line no-unused-vars -- parameters named in function types
  open: () => string[] | undefined;
  // eslint-disable-next-line no-unused-vars -- parameters named in function types
  write: (path: string, text: string) => void;
  // eslint-disable-next-line no-unused-vars -- parameters named in function types
  size: (path: string) => number;
  // eslint-disable-next-line no-unused-vars -- parameters named in function types
  read: (path: string) => string;
}

export const exportColours = (
  deps: ColourFileDeps,
  text: string
): ColourFileResult => {
  const path = deps.save();
  if (!path) return { ok: false, failure: 'cancelled' };
  if (isPoem(path)) return { ok: false, failure: 'poem' };
  try {
    deps.write(path, text);
  } catch (error) {
    return {
      ok: false,
      failure: 'unwritable',
      error: (error as Error).message,
    };
  }
  return { ok: true, path };
};

export const importColours = (deps: ColourFileDeps): ColourFileResult => {
  const path = deps.open()?.[0];
  if (!path) return { ok: false, failure: 'cancelled' };
  if (isPoem(path)) return { ok: false, failure: 'poem' };
  try {
    if (deps.size(path) > MAX_IMPORT_BYTES)
      return { ok: false, failure: 'tooLarge' };
    return { ok: true, path, text: deps.read(path) };
  } catch (error) {
    return {
      ok: false,
      failure: 'unreadable',
      error: (error as Error).message,
    };
  }
};

// The renderer names the file type and the suggested file name, in the panel's English.
export interface ColourFileWords {
  filterName: string;
  defaultName: string;
}

const isWords = (words: unknown): words is ColourFileWords =>
  typeof words === 'object' &&
  words !== null &&
  typeof (words as ColourFileWords).filterName === 'string' &&
  typeof (words as ColourFileWords).defaultName === 'string';

const depsFor = (
  window: BrowserWindow,
  words: ColourFileWords
): ColourFileDeps => ({
  save: () =>
    dialog.showSaveDialogSync(window, {
      defaultPath: words.defaultName,
      filters: [{ name: words.filterName, extensions: ['txt'] }],
    }),
  open: () =>
    dialog.showOpenDialogSync(window, {
      properties: ['openFile'],
      filters: [{ name: words.filterName, extensions: ['txt'] }],
    }),
  write: (path, text) => fs.writeFileSync(path, text, 'utf8'),
  size: (path) => fs.statSync(path).size,
  read: (path) => fs.readFileSync(path, 'utf8'),
});

// Registered from main.ts only in an audition build.
export const registerColourFiles = (window: () => BrowserWindow | null) => {
  ipcMain.on('colours-export', (event, text: unknown, words: unknown) => {
    const win = window();
    event.returnValue =
      win && typeof text === 'string' && isWords(words)
        ? exportColours(depsFor(win, words), text)
        : { ok: false, failure: 'unavailable' };
  });
  ipcMain.on('colours-import', (event, words: unknown) => {
    const win = window();
    event.returnValue =
      win && isWords(words)
        ? importColours(depsFor(win, words))
        : { ok: false, failure: 'unavailable' };
  });
};
