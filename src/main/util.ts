import { BrowserWindow } from 'electron';
import path from 'path';
import { URL } from 'url';
import { stripVersionInfo } from '@midst-press/midst-format/convert';
import store from './store';
import * as saveFailure from './saveFailurePolicy';

export function resolveHtmlPath(htmlFileName: string) {
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT || 1212;
    const url = new URL(`http://localhost:${port}`);
    url.pathname = htmlFileName;
    return url.href;
  }
  return `file://${path.resolve(__dirname, '../renderer/', htmlFileName)}`;
}

export const loadDataIntoWorkspace = (
  filename: string,
  data: string,
  mainWindow: BrowserWindow,
  darwin: boolean
) => {
  const { text, history, meta } = JSON.parse(stripVersionInfo(data));
  store.set('poem', text);
  store.set('history', JSON.stringify(history));
  // Always set, so a poem without meta never inherits the previous poem's.
  store.set('meta', meta === undefined ? '' : JSON.stringify(meta));
  store.set('filename', filename);
  store.set('baseFilename', path.basename(filename));
  // Another document: the last one's failed saves no longer apply (#94). The renderer clears its "not saved" on
  // 'open-file'.
  saveFailure.startAgain();
  mainWindow.webContents.send(
    'open-file',
    text,
    history,
    path.basename(filename)
  );
  if (darwin) {
    mainWindow.setDocumentEdited(false);
    mainWindow.setRepresentedFilename(path.basename(filename));
  }
  store.set('edited', JSON.stringify(false));
};
