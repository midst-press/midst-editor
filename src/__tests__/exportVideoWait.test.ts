/** @jest-environment node */
import { EventEmitter } from 'events';
import {
  ExportWindow,
  WAIT_MS,
  choosePreload,
  waitFor,
} from '../main/exportVideo';

// The export's waits on its hidden page (#506): a page that never answers, whose renderer goes, or which reports a
// failure ends the export with a reason, rather than hanging it (river-2fc1630e, review of #527).

const mockIpcMain = new EventEmitter();
jest.mock('electron', () => ({
  get ipcMain() {
    return mockIpcMain;
  },
  app: { quit: jest.fn(), exit: jest.fn() },
  BrowserWindow: jest.fn(),
}));
jest.mock('electron-log', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn() },
}));
jest.mock('../main/store', () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn() },
}));

const makeWindow = () => {
  const webContents = new EventEmitter();
  const win = new EventEmitter() as EventEmitter & {
    webContents: EventEmitter;
  };
  win.webContents = webContents;
  return win;
};
const fromPage = (win: ReturnType<typeof makeWindow>) => ({
  sender: win.webContents,
});
const listenerCount = (win: ReturnType<typeof makeWindow>) =>
  mockIpcMain.listenerCount('export-ready') +
  mockIpcMain.listenerCount('export-frame-ready') +
  mockIpcMain.listenerCount('export-failed') +
  win.listenerCount('closed') +
  win.webContents.listenerCount('render-process-gone');

beforeEach(() => {
  jest.useFakeTimers();
  mockIpcMain.removeAllListeners();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('waitFor', () => {
  it('resolves with the page’s message on the channel', async () => {
    const win = makeWindow();
    const p = waitFor(win as unknown as ExportWindow, 'export-frame-ready');
    mockIpcMain.emit('export-frame-ready', fromPage(win), [7]);
    await expect(p).resolves.toEqual([7]);
    expect(listenerCount(win)).toBe(0);
  });

  it('ignores another window’s message and a message the predicate refuses', async () => {
    const win = makeWindow();
    const other = makeWindow();
    const p = waitFor(
      win as unknown as ExportWindow,
      'export-frame-ready',
      ([n]) => n === 2
    );
    mockIpcMain.emit('export-frame-ready', fromPage(other), [2]);
    mockIpcMain.emit('export-frame-ready', fromPage(win), [1]);
    mockIpcMain.emit('export-frame-ready', fromPage(win), [2]);
    await expect(p).resolves.toEqual([2]);
  });

  it('a page that never answers fails, naming the channel, after the wait', async () => {
    const win = makeWindow();
    const p = waitFor(win as unknown as ExportWindow, 'export-ready');
    jest.advanceTimersByTime(WAIT_MS - 1);
    expect(listenerCount(win)).toBeGreaterThan(0); // still waiting a millisecond before
    jest.advanceTimersByTime(1);
    await expect(p).rejects.toThrow('export-ready not received in 30 s');
    expect(listenerCount(win)).toBe(0);
  });

  it('a renderer that goes fails at once, with its reason', async () => {
    const win = makeWindow();
    const p = waitFor(win as unknown as ExportWindow, 'export-ready');
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await expect(p).rejects.toThrow(
      "export page's renderer gone (crashed) while waiting for export-ready"
    );
    expect(listenerCount(win)).toBe(0);
  });

  it('the page’s own failure fails with its message', async () => {
    const win = makeWindow();
    const p = waitFor(win as unknown as ExportWindow, 'export-ready');
    mockIpcMain.emit('export-failed', fromPage(win), [
      'no frames were encoded',
    ]);
    await expect(p).rejects.toThrow('export page: no frames were encoded');
  });

  it('the window closing fails', async () => {
    const win = makeWindow();
    const p = waitFor(win as unknown as ExportWindow, 'export-ready');
    win.emit('closed');
    await expect(p).rejects.toThrow('export window closed');
  });
});

describe('choosePreload', () => {
  it('takes the first that exists', () => {
    expect(
      choosePreload(
        ['/dev/preload.js', '/built/preload.js'],
        (f) => f === '/built/preload.js'
      )
    ).toBe('/built/preload.js');
    expect(
      choosePreload(['/dev/preload.js', '/built/preload.js'], () => true)
    ).toBe('/dev/preload.js');
  });

  it('none fails, naming where it looked', () => {
    expect(() => choosePreload(['/a.js', '/b.js'], () => false)).toThrow(
      'no preload for the export window: /a.js, /b.js'
    );
  });
});
