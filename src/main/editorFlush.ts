import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';

// File > Save, Save As and Export as RTF… read the poem from the store, and the editor writes the store
// only when its autosave fires, a second after the last keystroke. Read straight away, they missed the
// poet's last keystrokes (#157). So they first ask the editor for the poem: it writes the store at once
// and answers, and the menu action reads the store after the answer. The store writes and the answer
// travel from the same window in order, so the answer arrives after the writes it follows.
//
// - Only while the editor is showing ('enable-save' / 'disable-save'). Elsewhere nothing is pending:
//   leaving the editor saves first.
// - Never waits forever. With no answer in FLUSH_TIMEOUT_MS the action goes ahead with the store as it
//   is, which is what it did before this change, and the log says so.
export const FLUSH_TIMEOUT_MS = 2000;

let editorShowing = false;
let nextId = 0;
const waiting = new Map<number, () => void>();

export const setEditorShowing = (showing: boolean) => {
  editorShowing = showing;
};

ipcMain.on('editor-flushed', (_event, args: unknown) => {
  const id = Array.isArray(args) ? args[0] : undefined;
  if (typeof id === 'number') waiting.get(id)?.();
});

export const flushEditor = (mainWindow: BrowserWindow): Promise<void> => {
  if (!editorShowing || mainWindow.isDestroyed()) return Promise.resolve();
  nextId += 1;
  const id = nextId;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      log.warn('the editor did not answer in time; using the stored poem', {
        timeoutMs: FLUSH_TIMEOUT_MS,
      });
      resolve();
    }, FLUSH_TIMEOUT_MS);
    waiting.set(id, () => {
      clearTimeout(timer);
      waiting.delete(id);
      resolve();
    });
    mainWindow.webContents.send('flush-editor', id);
  });
};
