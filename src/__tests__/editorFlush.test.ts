/** @jest-environment node */
import { ipcMain } from 'electron';
import log from 'electron-log';
import {
  FLUSH_TIMEOUT_MS,
  flushEditor,
  setEditorShowing,
} from '../main/editorFlush';

jest.mock('electron', () => ({ ipcMain: { on: jest.fn() } }));
jest.mock('electron-log', () => ({
  __esModule: true,
  default: { warn: jest.fn() },
}));

// The one 'editor-flushed' handler, registered when the module loads.
type Answer = Parameters<typeof ipcMain.on>[1];
const answer = (ipcMain.on as jest.Mock).mock.calls.find(
  ([channel]) => channel === 'editor-flushed'
)?.[1] as Answer;

const makeWindow = (destroyed = false) => ({
  isDestroyed: () => destroyed,
  webContents: { send: jest.fn() },
});
const asWindow = (w: ReturnType<typeof makeWindow>) => w as never;

// Whether the promise has settled, without waiting for it.
const settled = (p: Promise<void>) =>
  Promise.race([p.then(() => true), Promise.resolve().then(() => false)]);

beforeEach(() => {
  jest.useFakeTimers();
  (log.warn as jest.Mock).mockClear();
});
afterEach(() => {
  setEditorShowing(false);
  jest.useRealTimers();
});

describe('flushEditor (#157)', () => {
  it('registers one handler for the editor’s answer', () => {
    expect(
      (ipcMain.on as jest.Mock).mock.calls.filter(
        ([c]) => c === 'editor-flushed'
      )
    ).toHaveLength(1);
  });

  it('with no editor showing, asks nothing and goes ahead at once', async () => {
    const win = makeWindow();
    expect(await settled(flushEditor(asWindow(win)))).toBe(true);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('with the window gone, asks nothing and goes ahead at once', async () => {
    setEditorShowing(true);
    const win = makeWindow(true);
    expect(await settled(flushEditor(asWindow(win)))).toBe(true);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('with the editor showing, asks it and waits for its answer to that request', async () => {
    setEditorShowing(true);
    const win = makeWindow();
    const flushed = flushEditor(asWindow(win));
    expect(win.webContents.send).toHaveBeenCalledWith(
      'flush-editor',
      expect.any(Number)
    );
    const [, id] = win.webContents.send.mock.calls[0];
    expect(await settled(flushed)).toBe(false);
    answer({} as never, [id + 1000]); // another request's answer
    expect(await settled(flushed)).toBe(false);
    answer({} as never, [id]);
    expect(await settled(flushed)).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('each request has its own id', () => {
    setEditorShowing(true);
    const win = makeWindow();
    flushEditor(asWindow(win));
    flushEditor(asWindow(win));
    const [[, a], [, b]] = win.webContents.send.mock.calls;
    expect(a).not.toBe(b);
  });

  it('with no answer, goes ahead after the timeout and says so in the log', async () => {
    setEditorShowing(true);
    const flushed = flushEditor(asWindow(makeWindow()));
    jest.advanceTimersByTime(FLUSH_TIMEOUT_MS - 1);
    expect(await settled(flushed)).toBe(false);
    jest.advanceTimersByTime(1);
    expect(await settled(flushed)).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('an answer after the timeout is ignored', async () => {
    setEditorShowing(true);
    const win = makeWindow();
    const flushed = flushEditor(asWindow(win));
    const [, id] = win.webContents.send.mock.calls[0];
    jest.advanceTimersByTime(FLUSH_TIMEOUT_MS);
    await settled(flushed);
    expect(() => answer({} as never, [id])).not.toThrow();
  });

  it('a malformed answer is ignored', () => {
    expect(() => answer({} as never, undefined)).not.toThrow();
    expect(() => answer({} as never, ['zq'])).not.toThrow();
  });
});
