import { app, BrowserWindow, IpcMainEvent, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { stripVersionInfo } from '@midst-press/midst-format/convert';
import type { ChangeObj } from '@midst-press/midst-format/history';
import { WindowToMain } from '../shared/channels';
import sendToWindow from './sendToWindow';
import { resolveHtmlPath } from './util';

// File > Export as Video, proof of concept (#506). Development builds only, by environment:
//   MIDST_EXPORT_VIDEO_IN=<poem.midst> MIDST_EXPORT_VIDEO_OUT=<video.mp4>
// A hidden 1920×1080 window shows the export page (renderer/components/ExportVideo). For each frame, main asks it to
// draw frame n, captures the window, and hands the pixels back to the page, which encodes them (WebCodecs exists
// only in a page) and muxes them with Mediabunny. Nothing is shown and the poet's store is not written.

export const WIDTH = 1920;
export const HEIGHT = 1080;

export interface ExportJob {
  input: string;
  output: string;
}

export const exportJobFromEnv = (
  isPackaged: boolean,
  env: NodeJS.ProcessEnv
): ExportJob | null => {
  if (isPackaged) return null;
  const input = env.MIDST_EXPORT_VIDEO_IN;
  const output = env.MIDST_EXPORT_VIDEO_OUT;
  return input && output ? { input, output } : null;
};

/** The next message on a channel from this window, failing the export if the page reports a failure first. */
function waitFor<C extends keyof WindowToMain>(
  win: BrowserWindow,
  channel: C,
  // eslint-disable-next-line no-unused-vars -- the label says what the predicate receives
  match: (payload: WindowToMain[C]) => boolean = () => true
): Promise<WindowToMain[C]> {
  return new Promise((resolve, reject) => {
    const fromWin = (e: IpcMainEvent) => e.sender === win.webContents;
    /* eslint-disable no-unused-vars -- the labels say what each handler receives */
    const handlers: {
      message?: (e: IpcMainEvent, args: WindowToMain[C]) => void;
      fail?: (e: IpcMainEvent, args: WindowToMain['export-failed']) => void;
      closed?: () => void;
    } = {};
    /* eslint-enable no-unused-vars */
    const cleanup = () => {
      if (handlers.message) ipcMain.removeListener(channel, handlers.message);
      if (handlers.fail) ipcMain.removeListener('export-failed', handlers.fail);
      if (handlers.closed) win.removeListener('closed', handlers.closed);
    };
    handlers.message = (e, args) => {
      if (!fromWin(e) || !match(args)) return;
      cleanup();
      resolve(args);
    };
    handlers.fail = (e, args) => {
      if (!fromWin(e)) return;
      cleanup();
      reject(new Error(`export page: ${args[0]}`));
    };
    handlers.closed = () => {
      cleanup();
      reject(new Error('export window closed'));
    };
    ipcMain.on(channel, handlers.message);
    ipcMain.on('export-failed', handlers.fail);
    win.on('closed', handlers.closed);
  });
}

export async function exportVideo(
  job: ExportJob,
  preload: string
): Promise<void> {
  const data = fs.readFileSync(job.input, 'utf8');
  const { history } = JSON.parse(stripVersionInfo(data)) as {
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
    const done = waitFor(win, 'export-done');
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
  preload: string
): Promise<void> {
  try {
    await exportVideo(job, preload);
    app.quit();
  } catch (err) {
    log.error('export: failed', err);
    app.exit(1);
  }
}
