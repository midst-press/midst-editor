/* eslint-disable lingui/no-unlocalized-strings -- an audition tool for Annelyse and Frida (GitHub #119), in English only
   and never in a release; see src/renderer/colourAudition/README.md */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';

// View > Colours…: saving a colour set to a text file and reading one back (GitHub #119). The dialogs live here, in
// main, so their filters and the refusals below are enforced where the file is touched. A colour set is never a
// poem: a .midst path is refused both ways, so this can neither write over a poem nor try to read one.

export type ColourFileResult =
  { ok: true; text?: string; path: string } | { ok: false; reason: string };

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
  if (!path) return { ok: false, reason: 'cancelled' };
  if (isPoem(path))
    return {
      ok: false,
      reason:
        'A colour set is never saved as a .midst file, so no poem was touched.',
    };
  try {
    deps.write(path, text);
  } catch (error) {
    return { ok: false, reason: `Could not save: ${(error as Error).message}` };
  }
  return { ok: true, path };
};

export const importColours = (deps: ColourFileDeps): ColourFileResult => {
  const path = deps.open()?.[0];
  if (!path) return { ok: false, reason: 'cancelled' };
  if (isPoem(path))
    return {
      ok: false,
      reason: 'That is a poem, not a colour set, so it was not read.',
    };
  try {
    if (deps.size(path) > MAX_IMPORT_BYTES)
      return {
        ok: false,
        reason: 'That file is too large to be a colour set.',
      };
    return { ok: true, path, text: deps.read(path) };
  } catch (error) {
    return { ok: false, reason: `Could not read: ${(error as Error).message}` };
  }
};

const TEXT_FILTER = [{ name: 'Text', extensions: ['txt'] }];

const depsFor = (window: BrowserWindow): ColourFileDeps => ({
  save: () =>
    dialog.showSaveDialogSync(window, {
      defaultPath: 'Midst colours.txt',
      filters: TEXT_FILTER,
    }),
  open: () =>
    dialog.showOpenDialogSync(window, {
      properties: ['openFile'],
      filters: TEXT_FILTER,
    }),
  write: (path, text) => fs.writeFileSync(path, text, 'utf8'),
  size: (path) => fs.statSync(path).size,
  read: (path) => fs.readFileSync(path, 'utf8'),
});

// Registered from main.ts only in an audition build.
export const registerColourFiles = (window: () => BrowserWindow | null) => {
  ipcMain.on('colours-export', (event, text: unknown) => {
    const win = window();
    event.returnValue =
      win && typeof text === 'string'
        ? exportColours(depsFor(win), text)
        : { ok: false, reason: 'no window' };
  });
  ipcMain.on('colours-import', (event) => {
    const win = window();
    event.returnValue = win
      ? importColours(depsFor(win))
      : { ok: false, reason: 'no window' };
  });
};
