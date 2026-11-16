import { app, BrowserWindow, IpcMainEvent, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { stripVersionInfo } from '@midst-press/midst-format/convert';
import type { ChangeObj } from '@midst-press/midst-format/history';
import { WindowToMain } from '../shared/channels';
import sendToWindow from './sendToWindow';
import { resolveHtmlPath } from './util';
import { ExportJob } from './exportJob';

// File > Export as Video, proof of concept (#506). Development builds only, by environment:
//   MIDST_EXPORT_VIDEO_IN=<poem.midst> MIDST_EXPORT_VIDEO_OUT=<video.mp4>
// A hidden 1920×1080 window shows the export page (renderer/components/ExportVideo). For each frame, main asks it to
// draw frame n, captures the window, and hands the pixels back to the page, which encodes them (WebCodecs exists
// only in a page) and muxes them with Mediabunny. Nothing is shown and the poet's store is not written.

export const WIDTH = 1920;
export const HEIGHT = 1080;

// How long main waits for the page before giving up: a page that never answers (no preload, a crashed renderer)
// must end the export with a reason in the log, not hang it (river-2fc1630e, review of #527).
export const WAIT_MS = 30_000;
export const FINISH_WAIT_MS = 120_000;

/** The window's part of BrowserWindow that waitFor uses, so it can be tested without Electron's. */
/* eslint-disable no-unused-vars -- the labels say what each method receives */
export interface ExportWindow {
  webContents: {
    on(
      event: 'render-process-gone',
      listener: (...a: unknown[]) => void
    ): unknown;
    removeListener(
      event: 'render-process-gone',
      listener: (...a: unknown[]) => void
    ): unknown;
  };
  on(event: 'closed', listener: () => void): unknown;
  removeListener(event: 'closed', listener: () => void): unknown;
}
/* eslint-enable no-unused-vars */

/**
 * The next message on a channel from this window. Fails the export, naming the channel, if the page reports a
 * failure, its renderer goes, the window closes, or nothing comes within `timeoutMs`.
 */
export function waitFor<C extends keyof WindowToMain>(
  win: ExportWindow,
  channel: C,
  // eslint-disable-next-line no-unused-vars -- the label says what the predicate receives
  match: (payload: WindowToMain[C]) => boolean = () => true,
  timeoutMs: number = WAIT_MS
): Promise<WindowToMain[C]> {
  return new Promise((resolve, reject) => {
    const fromWin = (e: IpcMainEvent) =>
      (e.sender as unknown) === win.webContents;
    /* eslint-disable no-unused-vars -- the labels say what each handler receives */
    const handlers: {
      message?: (e: IpcMainEvent, args: WindowToMain[C]) => void;
      fail?: (e: IpcMainEvent, args: WindowToMain['export-failed']) => void;
      closed?: () => void;
      gone?: (...a: unknown[]) => void;
    } = {};
    /* eslint-enable no-unused-vars */
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      if (handlers.message) ipcMain.removeListener(channel, handlers.message);
      if (handlers.fail) ipcMain.removeListener('export-failed', handlers.fail);
      if (handlers.closed) win.removeListener('closed', handlers.closed);
      if (handlers.gone)
        win.webContents.removeListener('render-process-gone', handlers.gone);
    };
    const failWith = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    handlers.message = (e, args) => {
      if (!fromWin(e) || !match(args)) return;
      cleanup();
      resolve(args);
    };
    handlers.fail = (e, args) => {
      if (fromWin(e)) failWith(`export page: ${args[0]}`);
    };
    handlers.closed = () => failWith('export window closed');
    handlers.gone = (_event, details) =>
      failWith(
        `export page's renderer gone (${
          (details as { reason?: string } | undefined)?.reason ?? 'unknown'
        }) while waiting for ${channel}`
      );
    timer = setTimeout(
      () => failWith(`${channel} not received in ${timeoutMs / 1000} s`),
      timeoutMs
    );
    ipcMain.on(channel, handlers.message);
    ipcMain.on('export-failed', handlers.fail);
    win.on('closed', handlers.closed);
    win.webContents.on('render-process-gone', handlers.gone);
  });
}

/** The first preload that exists: the development one, else the one built beside the main bundle. */
export const choosePreload = (
  candidates: string[],
  // eslint-disable-next-line no-unused-vars -- the label says what the check receives
  exists: (file: string) => boolean = fs.existsSync
): string => {
  const found = candidates.find((c) => exists(c));
  if (!found)
    throw new Error(
      `no preload for the export window: ${candidates.join(', ')}`
    );
  return found;
};

export async function exportVideo(
  job: ExportJob,
  preloads: string[]
): Promise<void> {
  const preload = choosePreload(preloads);
  const data = fs.readFileSync(job.input, 'utf8');
  const { history } = JSON.parse(
    // A file written by midst_heatmaps' synth (kindled-poems) has no version line.
    data.startsWith('midstVersion:') ? stripVersionInfo(data) : data
  ) as {
    history: ChangeObj[];
  };
  if (!Array.isArray(history) || history.length === 0)
    throw new Error('the poem has no history to export');
  const title = path.basename(job.input).replace(/\.midst$/i, '');

  const win = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    paintWhenInitiallyHidden: true,
    webPreferences: { sandbox: false, preload, backgroundThrottling: false },
  });
  const t0 = Date.now();
  try {
    const ready = waitFor(win, 'export-ready');
    await win.loadURL(`${resolveHtmlPath('index.html')}?export=1`);
    await ready;
    const loaded = waitFor(win, 'export-loaded');
    sendToWindow(win, 'export-load', history, title);
    const [frames] = await loaded;
    log.info('export: started', { steps: history.length, frames });

    let draw = 0;
    let capture = 0;
    let encode = 0;
    for (let n = 0; n < frames; n += 1) {
      let t = Date.now();
      const drawn = waitFor(win, 'export-frame-ready', ([i]) => i === n);
      sendToWindow(win, 'export-frame', n);
      // eslint-disable-next-line no-await-in-loop -- one frame at a time: each capture must see its own frame
      await drawn;
      draw += Date.now() - t;
      t = Date.now();
      // eslint-disable-next-line no-await-in-loop
      let image = await win.webContents.capturePage();
      const size = image.getSize();
      if (size.width !== WIDTH || size.height !== HEIGHT)
        image = image.resize({ width: WIDTH, height: HEIGHT });
      const pixels = new Uint8Array(image.toBitmap());
      capture += Date.now() - t;
      t = Date.now();
      const encoded = waitFor(win, 'export-encoded', ([i]) => i === n);
      sendToWindow(win, 'export-encode', n, pixels, WIDTH, HEIGHT);
      // eslint-disable-next-line no-await-in-loop
      await encoded;
      encode += Date.now() - t;
    }
    const done = waitFor(win, 'export-done', () => true, FINISH_WAIT_MS);
    sendToWindow(win, 'export-finish');
    const [file] = await done;
    fs.writeFileSync(job.output, file);
    log.info('export: done', {
      frames,
      bytes: file.byteLength,
      totalMs: Date.now() - t0,
      perFrameMs: {
        draw: +(draw / frames).toFixed(1),
        capture: +(capture / frames).toFixed(1),
        encode: +(encode / frames).toFixed(1),
      },
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Export, then quit: exit code 1 and the error in the log if it failed. */
export async function exportAndQuit(
  job: ExportJob,
  preloads: string[]
): Promise<void> {
  try {
    await exportVideo(job, preloads);
    app.quit();
  } catch (err) {
    log.error('export: failed', err);
    app.exit(1);
  }
}
