/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import log from 'electron-log';
import MenuBuilder, {
  applyStoredAppearance,
  exportRtf,
  logIfRejected,
  newFile,
  openFile,
  save,
  saveAs,
} from '../main/menu';
import { showAbout } from '../main/about';
import { setEditorShowing } from '../main/editorFlush';
import * as rtf from '../main/rtf';

// Synthetic documents only: invented words, never a poem. Files named .midst live in a temporary
// directory and are removed after each test.

const mockStore = new Map<string, unknown>();
jest.mock('electron', () => ({
  app: {
    quit: jest.fn(),
    emit: jest.fn(),
    addRecentDocument: jest.fn(),
    getPath: (name: string) => `/test-home/${name}`,
  },
  dialog: {
    showMessageBoxSync: jest.fn(),
    showSaveDialogSync: jest.fn(),
    showOpenDialogSync: jest.fn(),
  },
  Menu: { buildFromTemplate: jest.fn(), setApplicationMenu: jest.fn() },
  shell: { openExternal: jest.fn(), showItemInFolder: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  BrowserWindow: jest.fn(),
  ipcMain: { on: jest.fn() },
}));
jest.mock('../main/about', () => ({ showAbout: jest.fn() }));
jest.mock('../main/logFile', () => ({
  logFilePath: () => '/zq/Logs/Midst/main.log',
}));
jest.mock('electron-log', () => ({
  __esModule: true,
  // Every level, so a new log call at any level can be asserted rather than throwing (#160).
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('../main/store', () => ({
  __esModule: true,
  default: {
    get: (k: string) => mockStore.get(k),
    set: (k: string, v: unknown) => mockStore.set(k, v),
  },
}));

const showMessageBox = dialog.showMessageBoxSync as jest.Mock;
const logError = log.error as jest.Mock;
const logWarn = log.warn as jest.Mock;
const logInfo = log.info as jest.Mock;
// Every line logged, as text, to check that no poem text reached the log.
const everythingLogged = () =>
  JSON.stringify(
    [log.debug, log.info, log.warn, log.error].map(
      (f) => (f as jest.Mock).mock.calls
    )
  );
const showSaveDialog = dialog.showSaveDialogSync as jest.Mock;
const showOpenDialog = dialog.showOpenDialogSync as jest.Mock;
const buildFromTemplate = Menu.buildFromTemplate as jest.Mock;
// editorFlush's one handler for the editor's answer, registered at import (before any clearAllMocks).
type Answer = Parameters<typeof ipcMain.on>[1];
const editorAnswers = (ipcMain.on as jest.Mock).mock.calls.find(
  ([channel]) => channel === 'editor-flushed'
)?.[1] as Answer;

const makeWindow = () => ({
  webContents: {
    send: jest.fn(),
    on: jest.fn(),
    reload: jest.fn(),
    toggleDevTools: jest.fn(),
    inspectElement: jest.fn(),
  },
  setDocumentEdited: jest.fn(),
  setRepresentedFilename: jest.fn(),
  setTitle: jest.fn(),
  isDestroyed: jest.fn(() => false),
  isFullScreen: jest.fn(() => false),
  setFullScreen: jest.fn(),
  close: jest.fn(),
});
type FakeWindow = ReturnType<typeof makeWindow>;
const asWindow = (w: FakeWindow) => w as never;

const history = [
  { inserted: 'zq', front: 0, end: 0, t: '2020-01-01T00:00:00.000Z' },
];
const goodFile = (text = '<p>zq</p>') =>
  `midstVersion: 1\n${JSON.stringify({ text, history })}`;

let dir: string;
const pendingIo: Promise<void>[] = [];

// Run the real fs call, and record when its callback has run so a test can wait on it exactly.
// Only reads have a callback: saving writes synchronously (#37).
const trackFsCallback = (name: 'readFile') => {
  const real = fs[name] as unknown as jest.Mock;
  jest.spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1] as jest.Mock;
    pendingIo.push(
      new Promise<void>((resolve) => {
        args[args.length - 1] = (...cbArgs: unknown[]) => {
          try {
            cb(...cbArgs);
          } finally {
            resolve();
          }
        };
      })
    );
    real(...args);
  }) as never);
};
// Export as RTF runs on the next turn of the event loop, after the editor's flush has answered.
const exportRan = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const ioDone = async () => {
  await Promise.all(pendingIo.splice(0));
};

// clearAllMocks keeps mockReturnValue between tests, so a dialog answer set by one test would
// reach the next. Each dialog mock is reset to throw: every test sets the answers it needs.
const unsetAnswer = () => {
  throw new Error('dialog answer not set by this test');
};

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  [showMessageBox, showSaveDialog, showOpenDialog].forEach((dialogMock) => {
    dialogMock.mockReset();
    dialogMock.mockImplementation(unsetAnswer);
  });
  pendingIo.length = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-test-'));
  trackFsCallback('readFile');
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const readBack = (p: string) => fs.readFileSync(p, 'utf8');
const dirListing = () => fs.readdirSync(dir).sort();

// A file that cannot be written: its folder does not exist.
const unwritable = () => path.join(dir, 'no-such-folder', 'zq.midst');
const SAVE_AS = 0;
const OK = 1;

const seedDocument = (over: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    poem: '<p>xv</p>',
    history: JSON.stringify(history),
    meta: '',
    edited: 'true',
    ...over,
  };
  Object.entries(values).forEach(([k, v]) => mockStore.set(k, v));
};

describe('save', () => {
  it('writes the stored document, with the version line, to the stored filename', async () => {
    const target = path.join(dir, 'zq.midst');
    seedDocument({ filename: target });
    const win = makeWindow();
    await save(asWindow(win), false);
    await ioDone();
    expect(readBack(target)).toBe(
      `midstVersion: 1\n${JSON.stringify({ text: '<p>xv</p>', history })}`
    );
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('writes meta back unchanged when the document has it', async () => {
    const target = path.join(dir, 'zq.midst');
    seedDocument({
      filename: target,
      meta: JSON.stringify({ fontSize: 3, unknownKey: 'xv' }),
    });
    await save(asWindow(makeWindow()), false);
    await ioDone();
    expect(JSON.parse(readBack(target).split('\n')[1]).meta).toEqual({
      fontSize: 3,
      unknownKey: 'xv',
    });
  });

  it('marks the document saved and tells the renderer the bare file name', async () => {
    const target = path.join(dir, 'zq.midst');
    seedDocument({ filename: target });
    const win = makeWindow();
    await save(asWindow(win), false);
    await ioDone();
    expect(mockStore.get('edited')).toBe('false');
    expect(mockStore.get('filename')).toBe(target);
    expect(mockStore.get('baseFilename')).toBe('zq.midst');
    expect(win.setTitle).not.toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith(
      'set-filename',
      'zq.midst'
    );
  });

  it('on macOS clears the edited dot and sets the represented file', async () => {
    const target = path.join(dir, 'zq.midst');
    seedDocument({ filename: target });
    const win = makeWindow();
    await save(asWindow(win), true);
    await ioDone();
    expect(win.setDocumentEdited).toHaveBeenCalledWith(false);
    expect(win.setRepresentedFilename).toHaveBeenCalledWith(target);
  });

  it('elsewhere leaves the macOS-only window calls alone', async () => {
    seedDocument({ filename: path.join(dir, 'zq.midst') });
    const win = makeWindow();
    await save(asWindow(win), false);
    await ioDone();
    expect(win.setDocumentEdited).not.toHaveBeenCalled();
    expect(win.setRepresentedFilename).not.toHaveBeenCalled();
  });

  it('asks where to save a document that has no file yet, and saves there', async () => {
    const target = path.join(dir, 'xv.midst');
    seedDocument({ filename: '' });
    showSaveDialog.mockReturnValue(target);
    await save(asWindow(makeWindow()), false);
    await ioDone();
    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(showSaveDialog.mock.calls[0][1].filters).toEqual([
      { name: 'Midst', extensions: ['midst'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    // Not whatever name the last save panel was given (midst-press/midst-editor#52).
    // In Documents before any poem has been opened or saved, not Downloads (Electron 43 and later).
    expect(showSaveDialog.mock.calls[0][1].defaultPath).toBe(
      path.join('/test-home/documents', 'Untitled.midst')
    );
    expect(readBack(target)).toContain('"text":"<p>xv</p>"');
    expect(mockStore.get('lastFolder')).toBe(dir);
    expect(mockStore.get('filename')).toBe(target);
  });

  it('writes a new, empty document as an empty document', async () => {
    const target = path.join(dir, 'zq.midst');
    seedDocument({ poem: '', history: '[]', filename: '' });
    showSaveDialog.mockReturnValue(target);
    await save(asWindow(makeWindow()), false);
    await ioDone();
    expect(readBack(target)).toBe(
      `midstVersion: 1\n${JSON.stringify({ text: '', history: [] })}`
    );
  });

  it('with no document in the store, asks nothing, writes nothing and says so', async () => {
    showSaveDialog.mockReturnValue(path.join(dir, 'zq.midst'));
    const win = makeWindow();
    await save(asWindow(win), false);
    await ioDone();
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(dirListing()).toEqual([]);
    expect(mockStore.get('filename')).toBeUndefined();
    expect(mockStore.get('baseFilename')).toBeUndefined();
    expect(win.webContents.send.mock.calls).toEqual([['cancel-save']]);
    expect(logError).toHaveBeenCalledWith(
      'save: no document in the store; nothing written'
    );
  });

  it.each(['poem', 'history'])(
    'leaves the file on disk alone when the stored %s is gone',
    async (missing) => {
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, 'earlier work');
      seedDocument({ filename: target });
      mockStore.delete(missing);
      await save(asWindow(makeWindow()), false);
      await ioDone();
      expect(readBack(target)).toBe('earlier work');
      expect(mockStore.get('edited')).toBe('true');
    }
  );

  it('a document that cannot be prepared: keeps no filename, tells the poet, and logs the error by name only (#160)', async () => {
    seedDocument({ filename: '', history: '{not json POEM-SENTINEL' });
    showSaveDialog.mockReturnValue(path.join(dir, 'zq.midst'));
    showMessageBox.mockReturnValue(OK);
    await save(asWindow(makeWindow()), false);
    await ioDone();
    expect(dirListing()).toEqual([]);
    expect(mockStore.get('filename')).toBe('');
    expect(mockStore.get('baseFilename')).toBeUndefined();
    expect(showMessageBox.mock.calls[0][1].detail).toContain(
      'The poem could not be prepared for saving.'
    );
    expect(logError).toHaveBeenCalledWith(
      'save: the document could not be prepared for writing',
      expect.objectContaining({
        filename: path.join(dir, 'zq.midst'),
        name: 'SyntaxError',
      })
    );
    expect(everythingLogged()).not.toContain('POEM-SENTINEL');
  });

  it('when the poet cancels the dialog, writes nothing, keeps the edited state and says so', async () => {
    seedDocument({ filename: '' });
    showSaveDialog.mockReturnValue(undefined);
    const win = makeWindow();
    await save(asWindow(win), false);
    expect(dirListing()).toEqual([]);
    expect(mockStore.get('edited')).toBe('true');
    expect(mockStore.get('filename')).toBe('');
    expect(win.webContents.send).toHaveBeenCalledWith('cancel-save');
    expect(win.webContents.send).not.toHaveBeenCalledWith(
      'set-filename',
      expect.anything()
    );
  });

  describe('when the file cannot be written (#37)', () => {
    it('keeps the document unsaved, records nothing, and tells the poet which file', async () => {
      const target = unwritable();
      seedDocument({ filename: target, baseFilename: 'zq.midst' });
      showMessageBox.mockReturnValue(OK);
      const win = makeWindow();
      await save(asWindow(win), true);
      expect(mockStore.get('edited')).toBe('true');
      expect(win.setDocumentEdited.mock.calls).toEqual([[true]]);
      expect(win.setTitle).not.toHaveBeenCalled();
      expect(win.setRepresentedFilename).not.toHaveBeenCalled();
      expect(win.webContents.send).not.toHaveBeenCalled();
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      const options = showMessageBox.mock.calls[0][1];
      expect(options.type).toBe('error');
      expect(options.message).toBe('Midst could not save "zq.midst".');
      expect(options.detail).toContain('ENOENT');
      expect(options.detail).toContain('it has not been saved to that file');
      expect(options.buttons).toEqual(['Save As…', 'OK']);
      expect(options.cancelId).toBe(OK);
      // OK asks for nothing more.
      expect(showSaveDialog).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledWith(
        'save: the document was not written',
        expect.objectContaining({
          filename: target,
          reason: expect.stringContaining('ENOENT'),
        })
      );
    });

    it('does not touch the macOS edited dot elsewhere', async () => {
      seedDocument({ filename: unwritable() });
      showMessageBox.mockReturnValue(OK);
      const win = makeWindow();
      await save(asWindow(win), false);
      expect(win.setDocumentEdited).not.toHaveBeenCalled();
      expect(mockStore.get('edited')).toBe('true');
    });

    it('does not move the folder the next dialog opens in', async () => {
      const target = unwritable();
      expect(path.dirname(target)).not.toBe(dir);
      seedDocument({ filename: target, lastFolder: dir });
      showMessageBox.mockReturnValue(OK);
      await save(asWindow(makeWindow()), false);
      expect(mockStore.get('lastFolder')).toBe(dir);
    });

    it('on Save As…, asks for another file and saves there', async () => {
      const elsewhere = path.join(dir, 'xv.midst');
      seedDocument({ filename: unwritable() });
      showMessageBox.mockReturnValue(SAVE_AS);
      showSaveDialog.mockReturnValue(elsewhere);
      const win = makeWindow();
      await save(asWindow(win), false);
      expect(readBack(elsewhere)).toContain('"text":"<p>xv</p>"');
      expect(mockStore.get('filename')).toBe(elsewhere);
      expect(mockStore.get('edited')).toBe('false');
      expect(win.webContents.send.mock.calls).toEqual([
        ['set-filename', 'xv.midst'],
      ]);
    });

    it('a first save to a file that cannot be written says so and keeps the document without a file', async () => {
      // A new document, saved by the editor as it opens: nothing unsaved yet, but the poet has just
      // chosen where it goes.
      seedDocument({ filename: '', edited: 'false' });
      showSaveDialog.mockReturnValue(unwritable());
      showMessageBox.mockReturnValue(OK);
      const win = makeWindow();
      await save(asWindow(win), false, false);
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(mockStore.get('filename')).toBe('');
      expect(mockStore.get('baseFilename')).toBeUndefined();
      // The editor stays open: a cancelled save sends the poet back to the start, a failed one does not.
      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('one of the editor\u2019s own saves says nothing when there was nothing unsaved', async () => {
      // The editor saves each document it opens; a poem opened from a read-only place is not an error.
      seedDocument({ filename: unwritable(), edited: 'false' });
      const win = makeWindow();
      await save(asWindow(win), true, false);
      expect(showMessageBox).not.toHaveBeenCalled();
      expect(win.setDocumentEdited).not.toHaveBeenCalled();
      expect(mockStore.get('edited')).toBe('false');
    });

    it('the editor\u2019s own saves tell the poet once per file, not after every pause in typing', async () => {
      const target = unwritable();
      seedDocument({ filename: target });
      showMessageBox.mockReturnValue(OK);
      const win = makeWindow();
      await save(asWindow(win), true, false);
      await save(asWindow(win), true, false);
      await save(asWindow(win), true, false);
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      // Still unsaved, and still shown as unsaved, every time.
      expect(mockStore.get('edited')).toBe('true');
      expect(win.setDocumentEdited.mock.calls).toEqual([
        [true],
        [true],
        [true],
      ]);
    });

    it('tells the poet again for another file, and again for the same file after a save that worked', async () => {
      const first = unwritable();
      const second = path.join(dir, 'also-missing', 'xv.midst');
      showMessageBox.mockReturnValue(OK);
      seedDocument({ filename: first });
      await save(asWindow(makeWindow()), false, false);
      seedDocument({ filename: second });
      await save(asWindow(makeWindow()), false, false);
      expect(showMessageBox).toHaveBeenCalledTimes(2);

      // The folder appears: the save works. Then it goes away again.
      fs.mkdirSync(path.dirname(second));
      await save(asWindow(makeWindow()), false, false);
      expect(mockStore.get('edited')).toBe('false');
      fs.rmSync(path.dirname(second), { recursive: true });
      seedDocument({ filename: second });
      await save(asWindow(makeWindow()), false, false);
      expect(showMessageBox).toHaveBeenCalledTimes(3);
    });

    it('a save the poet chooses always says so, even straight after they were told', async () => {
      const target = unwritable();
      seedDocument({ filename: target });
      showMessageBox.mockReturnValue(OK);
      await save(asWindow(makeWindow()), false, false);
      await save(asWindow(makeWindow()), false);
      await save(asWindow(makeWindow()), false);
      expect(showMessageBox).toHaveBeenCalledTimes(3);
    });

    it('a save the poet chooses says so even when nothing was unsaved', async () => {
      seedDocument({ filename: unwritable(), edited: 'false' });
      showMessageBox.mockReturnValue(OK);
      const win = makeWindow();
      await save(asWindow(win), true);
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      // Nothing was unsaved, so the edited dot is not switched on.
      expect(win.setDocumentEdited).not.toHaveBeenCalled();
    });

    it('when the leftover file cannot be removed either, tells the poet why the save failed and logs both (#95)', async () => {
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, 'earlier work');
      seedDocument({ filename: target });
      showMessageBox.mockReturnValue(OK);
      jest.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw new Error('EIO: zq');
      });
      jest.spyOn(fs, 'rmSync').mockImplementation(() => {
        const e = new Error('EBUSY: xv') as NodeJS.ErrnoException;
        e.code = 'EBUSY';
        throw e;
      });
      await save(asWindow(makeWindow()), true);
      expect(showMessageBox.mock.calls[0][1].detail).toContain('EIO: zq');
      expect(showMessageBox.mock.calls[0][1].detail).not.toContain('EBUSY');
      expect(log.error).toHaveBeenCalledWith(
        'save: the document was not written',
        expect.objectContaining({
          reason: 'EIO: zq',
          cleanupError: expect.objectContaining({ code: 'EBUSY' }),
        })
      );
    });

    it('leaves an existing file that cannot be replaced as it was', async () => {
      // Root may write to a read-only file, so there is nothing to observe as root.
      if (process.getuid?.() === 0) return;
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, 'earlier work');
      fs.chmodSync(target, 0o444);
      seedDocument({ filename: target });
      showMessageBox.mockReturnValue(OK);
      await save(asWindow(makeWindow()), false);
      expect(showMessageBox.mock.calls[0][1].detail).toMatch(/EACCES|EPERM/);
      expect(readBack(target)).toBe('earlier work');
      expect(mockStore.get('edited')).toBe('true');
    });
  });
});

describe('saveAs', () => {
  it('offers Untitled.midst for a document that has no file yet', async () => {
    seedDocument({ filename: '' });
    showSaveDialog.mockReturnValue(undefined);
    await saveAs(asWindow(makeWindow()), false);
    expect(showSaveDialog.mock.calls[0][1].defaultPath).toBe(
      path.join('/test-home/documents', 'Untitled.midst')
    );
  });

  it('offers the folder of the last poem opened or saved, while that folder exists', async () => {
    seedDocument({ filename: '', lastFolder: dir });
    showSaveDialog.mockReturnValue(undefined);
    await saveAs(asWindow(makeWindow()), false);
    expect(showSaveDialog.mock.calls[0][1].defaultPath).toBe(
      path.join(dir, 'Untitled.midst')
    );
    seedDocument({ filename: '', lastFolder: path.join(dir, 'gone') });
    await saveAs(asWindow(makeWindow()), false);
    expect(showSaveDialog.mock.calls[1][1].defaultPath).toBe(
      path.join('/test-home/documents', 'Untitled.midst')
    );
  });

  it('always asks, writes to the chosen file and leaves the previous file untouched', async () => {
    const previous = path.join(dir, 'zq.midst');
    const chosen = path.join(dir, 'xv.midst');
    fs.writeFileSync(previous, 'earlier work');
    seedDocument({ filename: previous });
    showSaveDialog.mockReturnValue(chosen);
    const win = makeWindow();
    await saveAs(asWindow(win), false);
    await ioDone();
    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(showSaveDialog.mock.calls[0][1].defaultPath).toBe(previous);
    expect(readBack(previous)).toBe('earlier work');
    expect(readBack(chosen)).toBe(
      `midstVersion: 1\n${JSON.stringify({ text: '<p>xv</p>', history })}`
    );
    expect(mockStore.get('filename')).toBe(chosen);
    expect(mockStore.get('baseFilename')).toBe('xv.midst');
    expect(mockStore.get('lastFolder')).toBe(dir);
    expect(mockStore.get('edited')).toBe('false');
    expect(win.webContents.send).toHaveBeenCalledWith(
      'set-filename',
      'xv.midst'
    );
    expect(win.setTitle).not.toHaveBeenCalled();
  });

  it('writes meta back unchanged', async () => {
    const chosen = path.join(dir, 'xv.midst');
    seedDocument({ meta: JSON.stringify({ title: 'zq' }) });
    showSaveDialog.mockReturnValue(chosen);
    await saveAs(asWindow(makeWindow()), false);
    await ioDone();
    expect(JSON.parse(readBack(chosen).split('\n')[1]).meta).toEqual({
      title: 'zq',
    });
  });

  it('on macOS clears the edited dot and sets the represented file', async () => {
    const chosen = path.join(dir, 'xv.midst');
    seedDocument();
    showSaveDialog.mockReturnValue(chosen);
    const win = makeWindow();
    await saveAs(asWindow(win), true);
    await ioDone();
    expect(win.setDocumentEdited).toHaveBeenCalledWith(false);
    expect(win.setRepresentedFilename).toHaveBeenCalledWith(chosen);
  });

  it('elsewhere leaves the macOS-only window calls alone', async () => {
    showSaveDialog.mockReturnValue(path.join(dir, 'xv.midst'));
    seedDocument();
    const win = makeWindow();
    await saveAs(asWindow(win), false);
    await ioDone();
    expect(win.setDocumentEdited).not.toHaveBeenCalled();
  });

  it.each(['poem', 'history'])(
    'with the stored %s gone, asks nothing and writes nothing, even over a file the poet could pick',
    async (missing) => {
      const existing = path.join(dir, 'zq.midst');
      fs.writeFileSync(existing, 'earlier work');
      seedDocument({ filename: existing });
      mockStore.delete(missing);
      showSaveDialog.mockReturnValue(existing);
      const win = makeWindow();
      await saveAs(asWindow(win), false);
      await ioDone();
      expect(showSaveDialog).not.toHaveBeenCalled();
      expect(readBack(existing)).toBe('earlier work');
      expect(mockStore.get('edited')).toBe('true');
      expect(win.webContents.send).not.toHaveBeenCalled();
    }
  );

  it('a document that cannot be prepared: keeps the previous filename, tells the poet, and logs by name only (#160)', async () => {
    const previous = path.join(dir, 'zq.midst');
    seedDocument({ filename: previous, history: '{not json POEM-SENTINEL' });
    showSaveDialog.mockReturnValue(path.join(dir, 'xv.midst'));
    showMessageBox.mockReturnValue(OK);
    await saveAs(asWindow(makeWindow()), false);
    await ioDone();
    expect(dirListing()).toEqual([]);
    expect(mockStore.get('filename')).toBe(previous);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      'saveAs: the document could not be prepared for writing',
      expect.objectContaining({ name: 'SyntaxError' })
    );
    expect(everythingLogged()).not.toContain('POEM-SENTINEL');
  });

  it('when the poet cancels, changes nothing', async () => {
    const previous = path.join(dir, 'zq.midst');
    seedDocument({ filename: previous });
    showSaveDialog.mockReturnValue(undefined);
    const win = makeWindow();
    await saveAs(asWindow(win), false);
    expect(dirListing()).toEqual([]);
    expect(mockStore.get('filename')).toBe(previous);
    expect(mockStore.get('edited')).toBe('true');
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(win.setTitle).not.toHaveBeenCalled();
  });

  describe('when the chosen file cannot be written (#37)', () => {
    it('keeps the previous file as the file of the document, keeps it unsaved, and says so', async () => {
      const previous = path.join(dir, 'zq.midst');
      seedDocument({ filename: previous, baseFilename: 'zq.midst' });
      showSaveDialog.mockReturnValue(unwritable());
      showMessageBox.mockReturnValue(OK);
      const win = makeWindow();
      await saveAs(asWindow(win), true);
      expect(mockStore.get('filename')).toBe(previous);
      expect(mockStore.get('baseFilename')).toBe('zq.midst');
      expect(mockStore.get('edited')).toBe('true');
      expect(win.setDocumentEdited.mock.calls).toEqual([[true]]);
      expect(win.setTitle).not.toHaveBeenCalled();
      expect(win.webContents.send).not.toHaveBeenCalled();
      expect(showMessageBox.mock.calls[0][1].type).toBe('error');
      expect(showSaveDialog).toHaveBeenCalledTimes(1);
    });

    it('says so even when nothing was unsaved: the poet asked for this file', async () => {
      seedDocument({ filename: path.join(dir, 'zq.midst'), edited: 'false' });
      showSaveDialog.mockReturnValue(unwritable());
      showMessageBox.mockReturnValue(OK);
      await saveAs(asWindow(makeWindow()), false);
      expect(showMessageBox).toHaveBeenCalledTimes(1);
    });

    it('on Save As…, asks again and saves to the next file chosen', async () => {
      const good = path.join(dir, 'xv.midst');
      seedDocument({ filename: '' });
      showSaveDialog
        .mockReturnValueOnce(unwritable())
        .mockReturnValueOnce(good);
      showMessageBox.mockReturnValue(SAVE_AS);
      await saveAs(asWindow(makeWindow()), false);
      expect(showSaveDialog).toHaveBeenCalledTimes(2);
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(mockStore.get('filename')).toBe(good);
      expect(mockStore.get('edited')).toBe('false');
      expect(dirListing()).toEqual(['xv.midst']);
    });
  });
});

describe('exportRtf (GitHub #26)', () => {
  const ERROR_TITLE = 'Could not export';

  it('offers the poem’s own name and folder, as .rtf', () => {
    seedDocument({ filename: path.join(dir, 'zq.midst') });
    showSaveDialog.mockReturnValue(undefined);
    exportRtf(asWindow(makeWindow()));
    expect(showSaveDialog.mock.calls[0][1].defaultPath).toBe(
      path.join(dir, 'zq.rtf')
    );
    expect(showSaveDialog.mock.calls[0][1].filters[0].extensions).toEqual([
      'rtf',
    ]);
  });

  it('offers Untitled.rtf in the dialog folder for a poem with no file', () => {
    seedDocument({ filename: '' });
    showSaveDialog.mockReturnValue(undefined);
    exportRtf(asWindow(makeWindow()));
    expect(showSaveDialog.mock.calls[0][1].defaultPath).toBe(
      path.join('/test-home/documents', 'Untitled.rtf')
    );
  });

  it('writes the RTF, and changes nothing about the poem or its file', () => {
    const poemFile = path.join(dir, 'zq.midst');
    const chosen = path.join(dir, 'zq.rtf');
    seedDocument({ filename: poemFile, poem: '<p><strong>xv</strong></p>' });
    showSaveDialog.mockReturnValue(chosen);
    const win = makeWindow();
    exportRtf(asWindow(win));
    expect(readBack(chosen)).toContain('{\\b xv}\\par');
    expect(dirListing()).toEqual(['zq.rtf']);
    expect(mockStore.get('filename')).toBe(poemFile);
    expect(mockStore.get('edited')).toBe('true');
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(win.setTitle).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('an empty poem: says why, and asks for no file', () => {
    showMessageBox.mockReturnValue(0); // error box with no buttons: the return value is unused
    seedDocument({ poem: '<p></p>' });
    exportRtf(asWindow(makeWindow()));
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(showMessageBox.mock.calls[0][1]).toMatchObject({
      type: 'error',
      title: ERROR_TITLE,
      detail: 'The poem is empty, so there is nothing to export.',
    });
    expect(logWarn).toHaveBeenCalledWith('exportRtf: refused', {
      reason: 'The poem is empty, so there is nothing to export.',
    });
  });

  it('no poem in the store: says so, and asks for no file', () => {
    showMessageBox.mockReturnValue(0); // error box with no buttons: the return value is unused
    seedDocument();
    mockStore.delete('poem');
    exportRtf(asWindow(makeWindow()));
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(showMessageBox.mock.calls[0][1].detail).toBe(
      'There is no poem open to export.'
    );
    expect(logError).toHaveBeenCalledWith(
      'exportRtf: no poem in the store; nothing written'
    );
  });

  it('when the poet cancels, writes nothing and says nothing', () => {
    seedDocument();
    showSaveDialog.mockReturnValue(undefined);
    exportRtf(asWindow(makeWindow()));
    expect(dirListing()).toEqual([]);
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('a file that cannot be written: says why, and leaves no part of a file', () => {
    showMessageBox.mockReturnValue(0); // error box with no buttons: the return value is unused
    seedDocument();
    showSaveDialog.mockReturnValue(unwritable().replace(/midst$/, 'rtf'));
    exportRtf(asWindow(makeWindow()));
    expect(showMessageBox.mock.calls[0][1].title).toBe(ERROR_TITLE);
    expect(showMessageBox.mock.calls[0][1].detail).toContain(
      'No file was written.'
    );
    expect(dirListing()).toEqual([]);
    expect(logError).toHaveBeenCalledWith(
      'exportRtf: the file was not written',
      expect.objectContaining({ reason: expect.stringContaining('ENOENT') })
    );
  });

  it('a write that fails partway leaves an existing file of that name as it was', () => {
    showMessageBox.mockReturnValue(0); // error box with no buttons: the return value is unused
    const chosen = path.join(dir, 'zq.rtf');
    fs.writeFileSync(chosen, 'earlier export');
    seedDocument();
    showSaveDialog.mockReturnValue(chosen);
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EIO: zq');
    });
    exportRtf(asWindow(makeWindow()));
    expect(readBack(chosen)).toBe('earlier export');
    expect(dirListing()).toEqual(['zq.rtf']);
    expect(showMessageBox.mock.calls[0][1].detail).toContain('EIO: zq');
  });
});

describe('newFile', () => {
  it('with unsaved changes, warns with Proceed/Cancel, and Return is Cancel', async () => {
    seedDocument({ edited: 'true' });
    showMessageBox.mockReturnValue(1);
    await newFile(asWindow(makeWindow()), false);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    const options = showMessageBox.mock.calls[0][1];
    expect(options.buttons).toEqual(['Proceed', 'Cancel']);
    // Return must never be the button that discards the poem (#40).
    expect(options.defaultId).toBe(1);
    expect(options.cancelId).toBe(1);
    expect(options.type).toBe('warning');
  });

  // Only the string 'false' means there is nothing to lose. A missing or empty value must still
  // ask, as the window's close handler does.
  it.each([['true'], [undefined], ['']])(
    'asks before discarding the document when edited is %p',
    async (edited) => {
      seedDocument();
      if (edited === undefined) mockStore.delete('edited');
      else mockStore.set('edited', edited);
      showMessageBox.mockReturnValue(1);
      const win = makeWindow();
      await newFile(asWindow(win), false);
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(mockStore.get('poem')).toBe('<p>xv</p>');
      expect(win.webContents.send).not.toHaveBeenCalled();
    }
  );

  it('when the poet cancels, keeps the document and tells the renderer nothing', async () => {
    seedDocument({ edited: 'true', filename: '/x/zq.midst' });
    showMessageBox.mockReturnValue(1);
    const win = makeWindow();
    await newFile(asWindow(win), true);
    expect(mockStore.get('poem')).toBe('<p>xv</p>');
    expect(mockStore.get('filename')).toBe('/x/zq.midst');
    expect(mockStore.get('edited')).toBe('true');
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(win.setTitle).not.toHaveBeenCalled();
  });

  it('when the poet proceeds, clears the document and tells the renderer', async () => {
    seedDocument({
      edited: 'true',
      filename: '/x/zq.midst',
      baseFilename: 'zq.midst',
      meta: '{"a":1}',
    });
    showMessageBox.mockReturnValue(0);
    const win = makeWindow();
    await newFile(asWindow(win), false);
    expect(mockStore.get('poem')).toBe('');
    expect(mockStore.get('history')).toBe('[]');
    expect(mockStore.get('meta')).toBe('');
    expect(mockStore.get('filename')).toBe('');
    expect(mockStore.get('baseFilename')).toBe('');
    expect(mockStore.get('edited')).toBe('false');
    expect(win.webContents.send).toHaveBeenCalledWith('open-file', '', [], '');
  });

  it('with no unsaved changes, does not ask', async () => {
    seedDocument({ edited: 'false' });
    const win = makeWindow();
    await newFile(asWindow(win), false);
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(mockStore.get('poem')).toBe('');
    expect(win.webContents.send).toHaveBeenCalledWith('open-file', '', [], '');
  });

  it("on macOS, represents the document as Untitled; the title is the renderer's on every platform (#125)", async () => {
    seedDocument({ edited: 'false' });
    const mac = makeWindow();
    await newFile(asWindow(mac), true);
    expect(mac.setTitle).not.toHaveBeenCalled();
    expect(mac.setRepresentedFilename).toHaveBeenCalledWith('Untitled');
    const other = makeWindow();
    await newFile(asWindow(other), false);
    expect(other.setTitle).not.toHaveBeenCalled();
  });
});

describe('openFile', () => {
  it('with unsaved changes and a Cancel, opens nothing and does not even ask for a file', async () => {
    seedDocument({ edited: 'true' });
    showMessageBox.mockReturnValue(1);
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, goodFile());
    await openFile(asWindow(makeWindow()), false, [target]);
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(mockStore.get('poem')).toBe('<p>xv</p>');
    expect(pendingIo).toHaveLength(0);
  });

  it.each([['true'], [undefined], ['']])(
    'asks before replacing the document when edited is %p, and a Cancel opens nothing',
    async (edited) => {
      seedDocument();
      if (edited === undefined) mockStore.delete('edited');
      else mockStore.set('edited', edited);
      showMessageBox.mockReturnValue(1);
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, goodFile());
      const win = makeWindow();
      await openFile(asWindow(win), false, [target]);
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(pendingIo).toHaveLength(0);
      expect(mockStore.get('poem')).toBe('<p>xv</p>');
      expect(win.webContents.send).not.toHaveBeenCalled();
    }
  );

  it('loads a current-version file given up front, without a file dialog', async () => {
    seedDocument({ edited: 'false' });
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, goodFile('<p>zq</p>'));
    const win = makeWindow();
    await openFile(asWindow(win), false, [target]);
    await ioDone();
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(mockStore.get('poem')).toBe('<p>zq</p>');
    expect(mockStore.get('filename')).toBe(target);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'open-file',
      '<p>zq</p>',
      history,
      'zq.midst'
    );
  });

  it('asks which file to open, with the Midst filter, when none is given', async () => {
    seedDocument({ edited: 'false' });
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, goodFile());
    showOpenDialog.mockReturnValue([target]);
    await openFile(asWindow(makeWindow()), false);
    await ioDone();
    expect(showOpenDialog.mock.calls[0][1].filters[0]).toEqual({
      name: 'Midst',
      extensions: ['midst'],
    });
    expect(showOpenDialog.mock.calls[0][1].defaultPath).toBe(
      '/test-home/documents'
    );
    expect(mockStore.get('filename')).toBe(target);
    expect(mockStore.get('lastFolder')).toBe(dir);
  });

  it('when the poet cancels the open dialog, reads nothing and changes nothing', async () => {
    seedDocument({ edited: 'false', filename: '/x/zq.midst' });
    showOpenDialog.mockReturnValue(undefined);
    const win = makeWindow();
    await openFile(asWindow(win), false);
    expect(pendingIo).toHaveLength(0);
    expect(mockStore.get('filename')).toBe('/x/zq.midst');
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('treats an empty selection like a cancel', async () => {
    seedDocument({ edited: 'false' });
    showOpenDialog.mockReturnValue([]);
    await openFile(asWindow(makeWindow()), false);
    expect(pendingIo).toHaveLength(0);
    expect(mockStore.get('poem')).toBe('<p>xv</p>');
  });

  it('on macOS, clears the edited dot for the opened file', async () => {
    seedDocument({ edited: 'false' });
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, goodFile());
    const win = makeWindow();
    await openFile(asWindow(win), true, [target]);
    await ioDone();
    expect(win.setDocumentEdited).toHaveBeenCalledWith(false);
    expect(win.setRepresentedFilename).toHaveBeenCalledWith('zq.midst');
  });

  it('a file of the current version that cannot be parsed shows an error and leaves the open document alone', async () => {
    showMessageBox.mockReturnValue(0); // error box with no buttons: the return value is unused
    seedDocument({ edited: 'false', filename: '/x/xv.midst' });
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, 'midstVersion: 1\n{not json POEM-SENTINEL');
    const win = makeWindow();
    await openFile(asWindow(win), false, [target]);
    await ioDone();
    expect(logError).toHaveBeenCalledWith(
      'open: the file could not be loaded',
      {
        filePath: target,
        name: 'SyntaxError',
        frames: expect.any(Array),
      }
    );
    expect(everythingLogged()).not.toContain('POEM-SENTINEL');
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    const options = showMessageBox.mock.calls[0][1];
    expect(options.type).toBe('error');
    expect(options.message).toContain(target);
    expect(mockStore.get('poem')).toBe('<p>xv</p>');
    expect(mockStore.get('filename')).toBe('/x/xv.midst');
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  describe('a file that cannot be read (#114)', () => {
    it.each([
      ['does not exist', (d: string) => path.join(d, 'gone.midst'), 'ENOENT'],
      ['is a folder', (d: string) => d, 'EISDIR'],
    ])(
      'when the path %s, says it could not be opened, with the reason, and offers no conversion',
      async (_case, target, code) => {
        showMessageBox.mockReturnValue(0); // error box with no buttons: the return value is unused
        seedDocument({ edited: 'false' });
        const win = makeWindow();
        await openFile(asWindow(win), false, [target(dir)]);
        await ioDone();
        expect(showMessageBox).toHaveBeenCalledTimes(1);
        const shown = showMessageBox.mock.calls[0][1];
        expect(shown.type).toBe('error');
        expect(shown.message).toContain(target(dir));
        expect(shown.message).toContain(code);
        expect(shown.buttons).toBeUndefined();
        expect(logError).toHaveBeenCalledWith(
          'open: the file could not be read',
          { filePath: target(dir), code }
        );
        expect(mockStore.get('poem')).toBe('<p>xv</p>');
        expect(win.webContents.send).not.toHaveBeenCalled();
      }
    );
  });

  it('loads nothing and shows nothing when the window has closed while the file was read', async () => {
    seedDocument({ edited: 'false' });
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, goodFile());
    const win = { ...makeWindow(), isDestroyed: jest.fn(() => true) };
    await openFile(asWindow(win), false, [target]);
    await ioDone();
    expect(win.isDestroyed).toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(mockStore.get('poem')).toBe('<p>xv</p>');
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  describe('a file of an older version', () => {
    const oldFile = JSON.stringify({
      editorTimelineFrames: [
        { content: '<p>zq</p>', lineNumber: '0', timestamp: 1000 },
      ],
    });

    it('offers Cancel or Convert File, defaulting to Convert', async () => {
      seedDocument({ edited: 'false' });
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, oldFile);
      showMessageBox.mockReturnValue(0);
      await openFile(asWindow(makeWindow()), false, [target]);
      await ioDone();
      const options = showMessageBox.mock.calls[0][1];
      expect(options.buttons).toEqual(['Cancel', 'Convert File']);
      expect(options.defaultId).toBe(1);
      expect(options.cancelId).toBe(0);
    });

    it('on Cancel, writes nothing, loads nothing and leaves the original as it was', async () => {
      seedDocument({ edited: 'false' });
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, oldFile);
      showMessageBox.mockReturnValue(0);
      const win = makeWindow();
      await openFile(asWindow(win), false, [target]);
      await ioDone();
      expect(dirListing()).toEqual(['zq.midst']);
      expect(readBack(target)).toBe(oldFile);
      expect(mockStore.get('poem')).toBe('<p>xv</p>');
      expect(app.addRecentDocument).not.toHaveBeenCalled();
      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('on Convert, writes a new file beside the original, loads it, and keeps the original', async () => {
      seedDocument({ edited: 'false' });
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, oldFile);
      showMessageBox.mockReturnValue(1);
      const win = makeWindow();
      await openFile(asWindow(win), false, [target]);
      await ioDone();
      const converted = path.join(dir, 'zq-converted.midst');
      expect(dirListing()).toEqual(['zq-converted.midst', 'zq.midst']);
      expect(readBack(target)).toBe(oldFile);
      const body = JSON.parse(readBack(converted).split('\n')[1]);
      expect(readBack(converted).startsWith('midstVersion: 1\n')).toBe(true);
      expect(body.text).toBe('<p>zq</p>');
      expect(app.addRecentDocument).toHaveBeenCalledWith(converted);
      expect(mockStore.get('filename')).toBe(converted);
      expect(win.webContents.send).toHaveBeenCalledWith(
        'open-file',
        '<p>zq</p>',
        body.history,
        'zq-converted.midst'
      );
    });

    it('logs that the version was not recognised, and the conversion', async () => {
      seedDocument({ edited: 'false' });
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, oldFile);
      showMessageBox.mockReturnValue(1);
      await openFile(asWindow(makeWindow()), false, [target]);
      await ioDone();
      expect(logInfo).toHaveBeenCalledWith(
        'open: version not recognised; offering to convert',
        { filePath: target }
      );
      expect(logInfo).toHaveBeenCalledWith('open: converted', {
        filePath: target,
        newFilename: path.join(dir, 'zq-converted.midst'),
      });
    });

    describe('when the conversion fails (#160)', () => {
      const failingAt = async (
        stage: 'convert' | 'write' | 'load',
        content: string
      ) => {
        seedDocument({ edited: 'false' });
        const target = path.join(dir, 'zq.midst');
        fs.writeFileSync(target, content);
        showMessageBox.mockReturnValueOnce(1).mockReturnValue(undefined);
        if (stage === 'write') {
          jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
            throw Object.assign(new Error('EACCES: POEM-SENTINEL'), {
              code: 'EACCES',
            });
          });
        }
        if (stage === 'load') {
          (app.addRecentDocument as jest.Mock).mockImplementationOnce(() => {
            throw new TypeError('POEM-SENTINEL');
          });
        }
        const win = makeWindow();
        await openFile(asWindow(win), false, [target]);
        await ioDone();
        return { target, win };
      };

      it('a file that cannot be converted: says so, writes nothing, and logs the stage and the error by name', async () => {
        const { target, win } = await failingAt(
          'convert',
          '{"POEM-SENTINEL": '
        );
        expect(dirListing()).toEqual(['zq.midst']);
        expect(showMessageBox.mock.calls[1][1]).toMatchObject({
          type: 'error',
          message: `The file ${target} could not be converted. The original file is unchanged.`,
        });
        expect(logError).toHaveBeenCalledWith(
          'open: the file could not be converted',
          expect.objectContaining({
            filePath: target,
            stage: 'convert',
            name: 'SyntaxError',
          })
        );
        expect(everythingLogged()).not.toContain('POEM-SENTINEL');
        expect(mockStore.get('poem')).toBe('<p>xv</p>');
        expect(win.webContents.send).not.toHaveBeenCalled();
      });

      it('a converted file that cannot be written: says so, and logs the write stage', async () => {
        const { target } = await failingAt('write', oldFile);
        expect(showMessageBox.mock.calls[1][1].message).toBe(
          `The file ${target} could not be converted. The original file is unchanged.`
        );
        const meta = logError.mock.calls.find(
          (c) => c[0] === 'open: the file could not be converted'
        )?.[1];
        expect(meta).toMatchObject({ stage: 'write', name: 'Error' });
        expect(meta).not.toHaveProperty('newFilename');
        expect(everythingLogged()).not.toContain('POEM-SENTINEL');
        expect(mockStore.get('poem')).toBe('<p>xv</p>');
      });

      it('a converted file that cannot be opened: names the file written, and logs the load stage', async () => {
        const { target } = await failingAt('load', oldFile);
        const converted = path.join(dir, 'zq-converted.midst');
        expect(dirListing()).toEqual(['zq-converted.midst', 'zq.midst']);
        expect(showMessageBox.mock.calls[1][1].message).toBe(
          `The converted file ${converted} was written, but could not be opened.`
        );
        expect(logError).toHaveBeenCalledWith(
          'open: the file could not be converted',
          expect.objectContaining({
            filePath: target,
            stage: 'load',
            newFilename: converted,
            name: 'TypeError',
          })
        );
        expect(everythingLogged()).not.toContain('POEM-SENTINEL');
      });
    });

    it('on Convert, never overwrites an earlier converted file', async () => {
      seedDocument({ edited: 'false' });
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, oldFile);
      fs.writeFileSync(path.join(dir, 'zq-converted.midst'), 'months of work');
      showMessageBox.mockReturnValue(1);
      await openFile(asWindow(makeWindow()), false, [target]);
      await ioDone();
      expect(readBack(path.join(dir, 'zq-converted.midst'))).toBe(
        'months of work'
      );
      expect(readBack(path.join(dir, 'zq-converted-2.midst'))).toContain(
        '"text":"<p>zq</p>"'
      );
      expect(mockStore.get('filename')).toBe(
        path.join(dir, 'zq-converted-2.midst')
      );
    });
  });
});

describe('the menu', () => {
  type Item = {
    id?: string;
    label?: string;
    accelerator?: string;
    enabled?: boolean;
    click?: () => unknown;
    submenu?: Item[];
  };
  const realPlatform = process.platform;
  const realNodeEnv = process.env.NODE_ENV;
  const realDebugProd = process.env.DEBUG_PROD;

  const setPlatform = (p: string) =>
    Object.defineProperty(process, 'platform', { value: p });

  beforeEach(() => {
    buildFromTemplate.mockImplementation(() => ({ popup: jest.fn() }));
  });
  afterEach(() => {
    setPlatform(realPlatform);
    process.env.NODE_ENV = realNodeEnv;
    if (realDebugProd === undefined) delete process.env.DEBUG_PROD;
    else process.env.DEBUG_PROD = realDebugProd;
  });

  const find = (items: Item[], label: string): Item => {
    const hit = items.find((i) => i.label === label);
    if (!hit) throw new Error(`no menu item ${label}`);
    return hit;
  };
  const sub = (template: Item[], top: string, label: string) =>
    find(find(template, top).submenu!, label);
  const build = (platform: string, win = makeWindow()) => {
    setPlatform(platform);
    new MenuBuilder(asWindow(win)).buildMenu();
    return buildFromTemplate.mock.calls[0][0] as Item[];
  };

  describe('entries from #121', () => {
    it('Select All on Windows and Linux is the selectAll role, not the macOS-only selector', () => {
      const item = sub(build('linux'), '&Edit', 'Select All') as Item & {
        role?: string;
        selector?: string;
      };
      expect(item.role).toBe('selectAll');
      expect(item.selector).toBeUndefined();
    });

    it('Save As on macOS is written modifiers first', () => {
      expect(sub(build('darwin'), 'File', 'Save As').accelerator).toBe(
        'Command+Shift+S'
      );
    });

    it('text size accelerators match between development and production macOS builds', () => {
      // Development
      process.env.NODE_ENV = 'development';
      const devInc = sub(build('darwin'), 'View', 'Increase text size');
      const devDec = sub(build('darwin'), 'View', 'Decrease text size');
      // Production
      process.env.NODE_ENV = 'production';
      delete process.env.DEBUG_PROD;
      const prodInc = sub(build('darwin'), 'View', 'Increase text size');
      const prodDec = sub(build('darwin'), 'View', 'Decrease text size');
      expect(devInc.accelerator).toBe(prodInc.accelerator);
      expect(devDec.accelerator).toBe(prodDec.accelerator);
      expect(devInc.accelerator).toBe('Command+Shift+=');
      expect(devDec.accelerator).toBe('Command+Shift+-');
    });

    it('text size accelerators on Windows and Linux use Ctrl', () => {
      const inc = sub(build('linux'), '&View', 'Increase text size');
      const dec = sub(build('linux'), '&View', 'Decrease text size');
      expect(inc.accelerator).toBe('Ctrl+=');
      expect(dec.accelerator).toBe('Ctrl+-');
    });
  });

  describe('buildMenu', () => {
    it('builds the macOS template on darwin, installs it and returns the menu', () => {
      setPlatform('darwin');
      const built = { popup: jest.fn() };
      buildFromTemplate.mockReturnValue(built);
      const menu = new MenuBuilder(asWindow(makeWindow())).buildMenu();
      const labels = (buildFromTemplate.mock.calls[0][0] as Item[]).map(
        (i) => i.label
      );
      expect(labels).toEqual([
        'Midst',
        'File',
        'Edit',
        'View',
        'Window',
        'Help',
      ]);
      expect(Menu.setApplicationMenu).toHaveBeenCalledWith(built);
      expect(menu).toBe(built);
    });

    it('builds the default template elsewhere', () => {
      const template = build('linux');
      expect(template.map((i) => i.label)).toEqual([
        '&File',
        '&Edit',
        '&View',
        'Help',
      ]);
    });

    it('in development, wires the inspect-element context menu; in production it does not', () => {
      process.env.NODE_ENV = 'development';
      const dev = makeWindow();
      build('linux', dev);
      expect(dev.webContents.on).toHaveBeenCalledWith(
        'context-menu',
        expect.any(Function)
      );
      jest.clearAllMocks();
      buildFromTemplate.mockImplementation(() => ({ popup: jest.fn() }));
      process.env.NODE_ENV = 'production';
      delete process.env.DEBUG_PROD;
      const prod = makeWindow();
      build('linux', prod);
      expect(prod.webContents.on).not.toHaveBeenCalled();
    });

    it('DEBUG_PROD=true also wires the context menu', () => {
      process.env.NODE_ENV = 'production';
      process.env.DEBUG_PROD = 'true';
      const win = makeWindow();
      build('linux', win);
      expect(win.webContents.on).toHaveBeenCalled();
    });

    it('the context menu pops up in the window and inspects the clicked point', () => {
      process.env.NODE_ENV = 'development';
      const win = makeWindow();
      build('linux', win);
      const handler = win.webContents.on.mock.calls[0][1] as jest.Mock;
      const popup = jest.fn();
      buildFromTemplate.mockReturnValueOnce({ popup });
      handler({}, { x: 7, y: 9 });
      const contextTemplate = buildFromTemplate.mock.calls.at(-1)![0] as Item[];
      expect(contextTemplate).toHaveLength(1);
      expect(popup).toHaveBeenCalledWith({ window: win });
      contextTemplate[0].click!();
      expect(win.webContents.inspectElement).toHaveBeenCalledWith(7, 9);
    });
  });

  describe.each([
    ['darwin', true],
    ['linux', false],
  ])('on %s', (platform, isMac) => {
    const fileLabels = isMac
      ? {
          top: 'File',
          save: 'Save',
          saveAs: 'Save As',
          nw: 'New',
          open: 'Open',
        }
      : {
          top: '&File',
          save: '&Save',
          saveAs: '&Save As',
          nw: '&New',
          open: '&Open',
        };
    const editTop = isMac ? 'Edit' : '&Edit';
    const viewTop = isMac ? 'View' : '&View';
    const helpTop = 'Help';
    const fullScreenLabel = isMac
      ? 'Toggle Full Screen'
      : 'Toggle &Full Screen';

    it('Save and Save As start disabled and carry the ids the renderer enables', () => {
      const template = build(platform);
      const saveItem = sub(template, fileLabels.top, fileLabels.save);
      const saveAsItem = sub(template, fileLabels.top, fileLabels.saveAs);
      expect(saveItem).toMatchObject({ id: 'save', enabled: false });
      expect(saveAsItem).toMatchObject({ id: 'save-as', enabled: false });
    });

    it('Save saves the document', async () => {
      const target = path.join(dir, 'zq.midst');
      seedDocument({ filename: target });
      const win = makeWindow();
      const item = sub(build(platform, win), fileLabels.top, fileLabels.save);
      await item.click!();
      await ioDone();
      expect(readBack(target)).toContain('"text":"<p>xv</p>"');
      expect(win.setDocumentEdited).toHaveBeenCalledTimes(isMac ? 1 : 0);
    });

    describe('the poem is taken from the editor first, not from the store it writes a second late (#157)', () => {
      // The editor is showing and holds a newer poem than the store: it writes it when asked, then answers.
      const editorHolding = (win: FakeWindow, poem: string) => {
        setEditorShowing(true);
        win.webContents.send.mockImplementation(
          (channel: string, id: unknown) => {
            if (channel !== 'flush-editor') return;
            mockStore.set('poem', poem);
            editorAnswers({} as never, [id]);
          }
        );
      };
      afterEach(() => setEditorShowing(false));

      it('Save', async () => {
        const target = path.join(dir, 'zq.midst');
        seedDocument({ filename: target });
        const win = makeWindow();
        editorHolding(win, '<p>xv qj</p>');
        await sub(build(platform, win), fileLabels.top, fileLabels.save)
          .click!();
        expect(readBack(target)).toContain('"text":"<p>xv qj</p>"');
      });

      it('Save As', async () => {
        const chosen = path.join(dir, 'xv.midst');
        seedDocument({ filename: path.join(dir, 'zq.midst') });
        showSaveDialog.mockReturnValue(chosen);
        const win = makeWindow();
        editorHolding(win, '<p>xv qj</p>');
        await sub(build(platform, win), fileLabels.top, fileLabels.saveAs)
          .click!();
        expect(readBack(chosen)).toContain('"text":"<p>xv qj</p>"');
      });

      it('Export as RTF…', async () => {
        const chosen = path.join(dir, 'zq.rtf');
        seedDocument();
        showSaveDialog.mockReturnValue(chosen);
        const win = makeWindow();
        editorHolding(win, '<p>xv qj</p>');
        await sub(build(platform, win), fileLabels.top, 'Export as RTF…')
          .click!();
        await exportRan();
        expect(readBack(chosen)).toContain('xv qj');
      });
    });

    describe('New and Open ask the editor first, so the prompt knows about the last second of typing (#113)', () => {
      // Saved, but the editor holds typing no store write has carried: it marks the document unsaved.
      const editorTypedSinceSave = (win: FakeWindow) => {
        setEditorShowing(true);
        win.webContents.send.mockImplementation(
          (channel: string, id: unknown) => {
            if (channel !== 'flush-editor') return;
            mockStore.set('edited', 'true');
            editorAnswers({} as never, [id]);
          }
        );
      };
      afterEach(() => setEditorShowing(false));

      it('New', async () => {
        seedDocument({ edited: 'false' });
        showMessageBox.mockReturnValue(1);
        const win = makeWindow();
        editorTypedSinceSave(win);
        await sub(build(platform, win), fileLabels.top, fileLabels.nw).click!();
        expect(showMessageBox).toHaveBeenCalledTimes(1);
        expect(mockStore.get('poem')).toBe('<p>xv</p>');
      });

      it('Open', async () => {
        seedDocument({ edited: 'false' });
        showMessageBox.mockReturnValue(1);
        const win = makeWindow();
        editorTypedSinceSave(win);
        await sub(build(platform, win), fileLabels.top, fileLabels.open)
          .click!();
        expect(showMessageBox).toHaveBeenCalledTimes(1);
        expect(showOpenDialog).not.toHaveBeenCalled();
      });
    });

    it('Export as RTF… asks for a file and writes the poem there as RTF', async () => {
      const chosen = path.join(dir, 'zq.rtf');
      seedDocument();
      showSaveDialog.mockReturnValue(chosen);
      await sub(build(platform), fileLabels.top, 'Export as RTF…').click!();
      await exportRan();
      expect(readBack(chosen)).toMatch(/^\{\\rtf1[\s\S]*xv\\par\n\}\n$/);
    });

    // On main a throw from exportRtf is synchronous, so it reaches uncaughtException and the poet is
    // told. After the flush it must still escape on its own, not settle a promise that is only logged.
    it('Export as RTF… a throw from the export escapes the promise, as before the flush (#188)', async () => {
      seedDocument();
      const deferred: Array<() => void> = [];
      const immediate = jest.spyOn(global, 'setImmediate').mockImplementation(((
        fn: () => void
      ) => {
        deferred.push(fn);
      }) as never);
      const toRtf = jest.spyOn(rtf, 'poemToRtf').mockImplementation(() => {
        throw new Error('zq export failed');
      });
      try {
        await sub(build(platform), fileLabels.top, 'Export as RTF…').click!();
        expect(deferred).toHaveLength(1);
        expect(() => deferred[0]()).toThrow('zq export failed');
        expect(log.error).not.toHaveBeenCalledWith(
          'exportRtf: failed',
          expect.anything()
        );
      } finally {
        immediate.mockRestore();
        toRtf.mockRestore();
      }
    });

    // The document already has a file, so plain Save would write there without asking. Save As
    // must ask anyway and leave that file alone.
    it('Save As asks for a file and writes there', async () => {
      const current = path.join(dir, 'zq.midst');
      const chosen = path.join(dir, 'xv.midst');
      seedDocument({ filename: current });
      showSaveDialog.mockReturnValue(chosen);
      const item = sub(build(platform), fileLabels.top, fileLabels.saveAs);
      await item.click!();
      await ioDone();
      expect(showSaveDialog).toHaveBeenCalledTimes(1);
      expect(readBack(chosen)).toContain('"text":"<p>xv</p>"');
      expect(fs.existsSync(current)).toBe(false);
    });

    it('New guards unsaved changes before clearing the document', async () => {
      seedDocument({ edited: 'true' });
      showMessageBox.mockReturnValue(1);
      const win = makeWindow();
      await sub(build(platform, win), fileLabels.top, fileLabels.nw).click!();
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(mockStore.get('poem')).toBe('<p>xv</p>');
      showMessageBox.mockReturnValue(0);
      await sub(
        buildFromTemplate.mock.calls[0][0],
        fileLabels.top,
        fileLabels.nw
      ).click!();
      expect(mockStore.get('poem')).toBe('');
    });

    it('Open guards unsaved changes, then opens the chosen file', async () => {
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, goodFile('<p>zq</p>'));
      seedDocument({ edited: 'true' });
      showMessageBox.mockReturnValue(0);
      showOpenDialog.mockReturnValue([target]);
      const item = sub(build(platform), fileLabels.top, fileLabels.open);
      await item.click!();
      await ioDone();
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(mockStore.get('poem')).toBe('<p>zq</p>');
    });

    it('Toggle Timeline is on Command+T or Ctrl+T, and no two items share a shortcut (GitHub #21)', () => {
      const template = build(platform);
      expect(sub(template, editTop, 'Toggle Timeline').accelerator).toBe(
        isMac ? 'Command+T' : 'Ctrl+T'
      );
      const accelerators: string[] = [];
      const walk = (items: Item[]) =>
        items.forEach((i) => {
          // One shortcut however it is written: Shift+Command+Z is Command+Shift+Z.
          if (i.accelerator)
            accelerators.push(
              i.accelerator.toLowerCase().split('+').sort().join('+')
            );
          if (i.submenu) walk(i.submenu);
        });
      walk(template);
      expect(accelerators.length).toBeGreaterThan(10);
      expect(new Set(accelerators).size).toBe(accelerators.length);
    });

    it('Toggle Timeline and the spellcheck toggle message the renderer', () => {
      const win = makeWindow();
      const template = build(platform, win);
      sub(template, editTop, 'Toggle Timeline').click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith('toggle-edit-mode');
      sub(
        template,
        editTop,
        isMac ? 'Show/hide spellcheck' : 'Toggle Spellcheck'
      ).click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith(
        'toggle-spellcheck'
      );
    });

    it('Find is on Command+F or Ctrl+F and opens the find bar (GitHub #27)', () => {
      const win = makeWindow();
      const item = sub(build(platform, win), editTop, 'Find');
      expect(item.accelerator).toBe(isMac ? 'Command+F' : 'Ctrl+F');
      item.click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith('find-in-poem');
    });

    it('Toggle Full Screen flips the window state', () => {
      const win = makeWindow();
      const item = sub(build(platform, win), viewTop, fullScreenLabel);
      item.click!();
      expect(win.setFullScreen).toHaveBeenLastCalledWith(true);
      win.isFullScreen.mockReturnValue(true);
      item.click!();
      expect(win.setFullScreen).toHaveBeenLastCalledWith(false);
    });

    it('text size buttons step the stored size and tell the renderer', () => {
      const win = makeWindow();
      const template = build(platform, win);
      const inc = sub(template, viewTop, 'Increase text size');
      const dec = sub(template, viewTop, 'Decrease text size');
      inc.click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith(
        'set-font-size',
        '3'
      );
      expect(Number(mockStore.get('font-size'))).toBe(3);
      dec.click!();
      dec.click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith(
        'set-font-size',
        '1'
      );
      expect(Number(mockStore.get('font-size'))).toBe(1);
    });

    it('Help links open the project pages in the browser', () => {
      const template = build(platform);
      sub(template, helpTop, 'Learn More').click!();
      expect(shell.openExternal).toHaveBeenLastCalledWith(
        'https://midst.press'
      );
      sub(template, helpTop, 'Documentation').click!();
      expect(shell.openExternal).toHaveBeenLastCalledWith(
        'https://github.com/midst-press/midst-editor/blob/main/docs/user-guide.md'
      );
    });

    it('Documentation in an installed app opens the guide at that version’s release tag (#102)', () => {
      const packaged = app as unknown as {
        isPackaged?: boolean;
        getVersion?: () => string;
      };
      packaged.isPackaged = true;
      packaged.getVersion = () => '0.5.0';
      try {
        sub(build(platform), helpTop, 'Documentation').click!();
        expect(shell.openExternal).toHaveBeenLastCalledWith(
          'https://github.com/midst-press/midst-editor/blob/v0.5.0/docs/user-guide.md'
        );
      } finally {
        delete packaged.isPackaged;
        delete packaged.getVersion;
      }
    });

    it('About Midst opens the About box on this window, from the menu this platform expects', () => {
      const win = makeWindow();
      const template = build(platform, win);
      sub(template, isMac ? 'Midst' : helpTop, 'About Midst').click!();
      expect(showAbout).toHaveBeenCalledTimes(1);
      expect(showAbout).toHaveBeenCalledWith(win);
      // One About per platform: macOS has it in the application menu only.
      const other = find(template, isMac ? helpTop : fileLabels.top).submenu!;
      expect(other.map((i) => i.label)).not.toContain('About Midst');
    });

    it('an About box that fails is logged with the action named, not left to the unhandled-rejection handler (#160)', async () => {
      (showAbout as jest.Mock).mockRejectedValueOnce(new TypeError('zq'));
      sub(
        build(platform, makeWindow()),
        isMac ? 'Midst' : helpTop,
        'About Midst'
      ).click!();
      await new Promise(process.nextTick);
      expect(logError).toHaveBeenCalledWith(
        'about: failed',
        expect.objectContaining({ name: 'TypeError' })
      );
    });

    it('a help link the OS cannot open is logged with the action named (#160)', async () => {
      (shell.openExternal as jest.Mock).mockRejectedValueOnce(new Error('zq'));
      sub(build(platform), helpTop, 'Documentation').click!();
      await new Promise(process.nextTick);
      expect(logError).toHaveBeenCalledWith(
        'documentation: failed',
        expect.objectContaining({ name: 'Error' })
      );
    });

    it('production View menu has no Reload or Developer Tools', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DEBUG_PROD;
      const view = find(build(platform), viewTop).submenu!.map((i) => i.label);
      expect(view).not.toContain(isMac ? 'Reload' : '&Reload');
      expect(view.some((l) => l?.includes('Developer Tools'))).toBe(false);
    });

    it('development View menu reloads and toggles developer tools', () => {
      process.env.NODE_ENV = 'development';
      const win = makeWindow();
      const template = build(platform, win);
      sub(template, viewTop, isMac ? 'Reload' : '&Reload').click!();
      expect(win.webContents.reload).toHaveBeenCalledTimes(1);
      sub(
        template,
        viewTop,
        isMac ? 'Toggle Developer Tools' : 'Toggle &Developer Tools'
      ).click!();
      expect(win.webContents.toggleDevTools).toHaveBeenCalledTimes(1);
      const full = sub(template, viewTop, fullScreenLabel);
      full.click!();
      expect(win.setFullScreen).toHaveBeenCalledWith(true);
      sub(template, viewTop, 'Increase text size').click!();
      sub(template, viewTop, 'Decrease text size').click!();
      expect(win.webContents.send).toHaveBeenCalledWith('set-font-size', '3');
      expect(win.webContents.send).toHaveBeenCalledWith('set-font-size', '2');
    });
  });

  describe('font size limits', () => {
    it('Increase stops at 4', () => {
      mockStore.set('font-size', '4');
      const win = makeWindow();
      sub(build('linux', win), '&View', 'Increase text size').click!();
      expect(win.webContents.send).not.toHaveBeenCalled();
      expect(mockStore.get('font-size')).toBe('4');
    });

    it('a stored size that is not a size is read as the default, not stepped into NaN', () => {
      mockStore.set('font-size', 'abc');
      const win = makeWindow();
      sub(build('linux', win), '&View', 'Increase text size').click!();
      expect(mockStore.get('font-size')).toBe('3');
      expect(win.webContents.send).toHaveBeenCalledWith('set-font-size', '3');
    });

    it('Decrease stops at 0', () => {
      mockStore.set('font-size', '0');
      const win = makeWindow();
      sub(build('linux', win), '&View', 'Decrease text size').click!();
      expect(win.webContents.send).not.toHaveBeenCalled();
      expect(mockStore.get('font-size')).toBe('0');
    });

    it('Increase and Decrease both store the size as a string, as the renderer does', () => {
      const win = makeWindow();
      const template = build('linux', win);
      sub(template, '&View', 'Increase text size').click!();
      expect(mockStore.get('font-size')).toBe('3');
      sub(template, '&View', 'Decrease text size').click!();
      expect(mockStore.get('font-size')).toBe('2');
    });

    it('reads a stored number 0 as size 0, not as unset', () => {
      mockStore.set('font-size', 0);
      const win = makeWindow();
      const template = build('linux', win);
      sub(template, '&View', 'Decrease text size').click!();
      expect(win.webContents.send).not.toHaveBeenCalled();
      sub(template, '&View', 'Increase text size').click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith(
        'set-font-size',
        '1'
      );
      expect(mockStore.get('font-size')).toBe('1');
    });

    it('reads an empty stored size as unset, so the default of 2 applies', () => {
      mockStore.set('font-size', '');
      const win = makeWindow();
      sub(build('linux', win), '&View', 'Increase text size').click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith(
        'set-font-size',
        '3'
      );
    });

    it('Increase reaches 4 from the default of 2 and then stops', () => {
      const win = makeWindow();
      const inc = sub(build('linux', win), '&View', 'Increase text size');
      inc.click!();
      inc.click!();
      inc.click!();
      expect(win.webContents.send).toHaveBeenCalledTimes(2);
      expect(win.webContents.send).toHaveBeenLastCalledWith(
        'set-font-size',
        '4'
      );
    });
  });

  describe('macOS only', () => {
    it('Quit quits the app', () => {
      sub(build('darwin'), 'Midst', 'Quit').click!();
      expect(app.quit).toHaveBeenCalledTimes(1);
    });

    it('New on a destroyed window resets the stored document and reactivates the app', () => {
      // Saved state on purpose. A destroyed window with unsaved work should not arise (closing is
      // held until the poet chooses), so what New does about it is not pinned here.
      seedDocument({ edited: 'false', filename: '/x/zq.midst' });
      const win = makeWindow();
      win.isDestroyed.mockReturnValue(true);
      sub(build('darwin', win), 'File', 'New').click!();
      expect(mockStore.get('poem')).toBe('');
      expect(mockStore.get('history')).toBe('[]');
      expect(mockStore.get('meta')).toBe('');
      expect(mockStore.get('filename')).toBe('');
      expect(mockStore.get('edited')).toBe('false');
      expect(app.emit).toHaveBeenCalledWith('activate', false);
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('Windows and Linux only', () => {
    it('Close closes the window', () => {
      const win = makeWindow();
      sub(build('linux', win), '&File', '&Close').click!();
      expect(win.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('Help > Show Log File', () => {
    it.each([
      ['darwin', 'Help'],
      ['linux', 'Help'],
    ])('on %s shows the log file in the file browser', (platform, menu) => {
      process.env.NODE_ENV = 'production';
      const template = build(platform);
      const item = sub(template, menu, 'Show Log File');
      expect(item.accelerator).toBeUndefined();
      item.click!();
      expect(shell.showItemInFolder).toHaveBeenCalledWith(
        '/zq/Logs/Midst/main.log'
      );
    });
  });

  describe('View > Appearance (GitHub #16)', () => {
    type Radio = Item & { type?: string; checked?: boolean };
    const appearance = (platform: string) => {
      process.env.NODE_ENV = 'production';
      delete process.env.DEBUG_PROD;
      const template = build(platform);
      return sub(
        template,
        platform === 'darwin' ? 'View' : '&View',
        'Appearance'
      ).submenu as Radio[];
    };

    beforeEach(() => {
      nativeTheme.themeSource = 'system';
    });

    it.each(['darwin', 'linux'])(
      'offers Follow System, Light and Dark as one choice on %s',
      (platform) => {
        const items = appearance(platform);
        expect(items.map((i) => [i.label, i.type])).toEqual([
          ['Follow System', 'radio'],
          ['Light', 'radio'],
          ['Dark', 'radio'],
        ]);
      }
    );

    it('is also in the development View menu', () => {
      process.env.NODE_ENV = 'development';
      const template = build('darwin');
      expect(sub(template, 'View', 'Appearance').submenu).toHaveLength(3);
    });

    it.each([
      [undefined, 'Follow System'],
      ['light', 'Light'],
      ['dark', 'Dark'],
      ['system', 'Follow System'],
      ['purple', 'Follow System'],
    ])('with %p stored, checks %s', (stored, label) => {
      if (stored !== undefined) mockStore.set('appearance', stored);
      expect(
        appearance('darwin')
          .filter((i) => i.checked)
          .map((i) => i.label)
      ).toEqual([label]);
    });

    it.each([
      ['Dark', 'dark'],
      ['Light', 'light'],
      ['Follow System', 'system'],
    ])('choosing %s stores it and sets the scheme', (label, value) => {
      mockStore.set(
        'appearance',
        label === 'Follow System' ? 'dark' : 'system'
      );
      find(appearance('linux'), label).click!();
      expect(mockStore.get('appearance')).toBe(value);
      expect(nativeTheme.themeSource).toBe(value);
    });
  });
});

describe('applyStoredAppearance (GitHub #16)', () => {
  it.each([
    [undefined, 'system'],
    ['dark', 'dark'],
    ['light', 'light'],
    ['', 'system'],
    ['Dark', 'system'],
  ])('with %p stored, sets the scheme to %s', (stored, expected) => {
    nativeTheme.themeSource = 'light';
    if (stored !== undefined) mockStore.set('appearance', stored);
    applyStoredAppearance();
    expect(nativeTheme.themeSource).toBe(expected);
  });
});

describe('logIfRejected (#160)', () => {
  it('logs a rejection with the action named, by the error name only', async () => {
    logIfRejected('zq', () => Promise.reject(new RangeError('POEM-SENTINEL')));
    await new Promise(process.nextTick);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith('zq: failed', {
      name: 'RangeError',
      frames: expect.any(Array),
    });
    expect(everythingLogged()).not.toContain('POEM-SENTINEL');
  });

  it('returns a promise that settles once the action has, so a click can be awaited', async () => {
    let done = false;
    const settled = logIfRejected('zq', async () => {
      await new Promise(process.nextTick);
      done = true;
    });
    expect(settled).toBeInstanceOf(Promise);
    expect(done).toBe(false);
    await settled;
    expect(done).toBe(true);
    await expect(
      logIfRejected('xv', () => Promise.reject(new Error('zq')))
    ).resolves.toBeUndefined();
    expect(logIfRejected('qj', () => 7)).toBe(7);
  });

  it('logs nothing when the action resolves, or returns no promise', async () => {
    logIfRejected('zq', () => Promise.resolve(1));
    logIfRejected('xv', () => undefined);
    await new Promise(process.nextTick);
    expect(logError).not.toHaveBeenCalled();
  });

  it('leaves a synchronous throw to the uncaught-error handler, which also tells the poet', () => {
    expect(() =>
      logIfRejected('zq', () => {
        throw new Error('xv');
      })
    ).toThrow('xv');
    expect(logError).not.toHaveBeenCalled();
  });
});
