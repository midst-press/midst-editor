/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';

// Synthetic documents only: invented words, never a poem. Files named .midst exist only inside a
// temporary directory and are removed after each test.
//
// main.ts registers its handlers when it is imported, so every test gets a fresh module registry
// (jest.resetModules) and a fresh electron stand-in. The stand-in RECORDS what main.ts registers;
// the tests then call the recorded handlers the way electron would.

type Handler = jest.Mock;

interface FakeWindow {
  options: Record<string, unknown>;
  handlers: Record<string, Handler[]>;
  loadURL: jest.Mock;
  show: jest.Mock;
  minimize: jest.Mock;
  destroy: jest.Mock;
  setDocumentEdited: jest.Mock;
  setRepresentedFilename: jest.Mock;
  webContents: { send: jest.Mock; setWindowOpenHandler: jest.Mock };
}

interface ElectronState {
  ipc: Map<string, Handler[]>;
  appHandlers: Map<string, Handler[]>;
  windows: FakeWindow[];
  dialogResponse: number;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: jest.Mock;
  menuItems: Record<string, { enabled: boolean }>;
}

interface FakeElectron {
  mockState: ElectronState;
  app: {
    quit: jest.Mock;
    applicationMenu: { getMenuItemById: jest.Mock } | undefined;
  };
  dialog: { showMessageBoxSync: jest.Mock };
  shell: { openExternal: jest.Mock };
}

jest.mock('electron', () => {
  const state = {
    ipc: new Map<string, Handler[]>(),
    appHandlers: new Map<string, Handler[]>(),
    windows: [] as unknown[],
    dialogResponse: 0,
    menuItems: {
      save: { enabled: false },
      'save-as': { enabled: false },
    } as Record<string, { enabled: boolean }>,
  } as Record<string, unknown>;
  state.ready = new Promise<void>((resolve, reject) => {
    state.resolveReady = resolve;
    state.rejectReady = reject;
  });
  const record = (map: Map<string, Handler[]>, key: string, fn: Handler) => {
    map.set(key, [...(map.get(key) ?? []), fn]);
  };
  class BrowserWindow {
    options: Record<string, unknown>;

    handlers: Record<string, Handler[]> = {};

    loadURL = jest.fn();

    show = jest.fn();

    minimize = jest.fn();

    destroy = jest.fn();

    setDocumentEdited = jest.fn();

    setRepresentedFilename = jest.fn();

    webContents = { send: jest.fn(), setWindowOpenHandler: jest.fn() };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      (state.windows as unknown[]).push(this);
    }

    on(event: string, fn: Handler) {
      this.handlers[event] = [...(this.handlers[event] ?? []), fn];
    }
  }
  return {
    mockState: state,
    app: {
      isPackaged: false,
      quit: jest.fn(),
      on: (event: string, fn: Handler) =>
        record(state.appHandlers as Map<string, Handler[]>, event, fn),
      whenReady: () => state.ready,
      applicationMenu: {
        getMenuItemById: jest.fn(
          (id: string) =>
            (state.menuItems as Record<string, { enabled: boolean }>)[id]
        ),
      },
    },
    BrowserWindow,
    dialog: { showMessageBoxSync: jest.fn(() => state.dialogResponse) },
    shell: { openExternal: jest.fn() },
    ipcMain: {
      on: (channel: string, fn: Handler) =>
        record(state.ipc as Map<string, Handler[]>, channel, fn),
      emit: (channel: string, ...args: unknown[]) => {
        const handlers =
          (state.ipc as Map<string, Handler[]>).get(channel) ?? [];
        handlers.forEach((fn) => fn(...args));
        return handlers.length > 0;
      },
    },
  };
});

jest.mock('electron-updater', () => ({
  autoUpdater: { checkForUpdatesAndNotify: jest.fn(), logger: null },
}));

jest.mock('electron-log', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    transports: { file: { level: 'info' }, console: { level: 'info' } },
  },
}));

jest.mock('@jshafto/custom-electron-titlebar-update/main', () => ({
  setupTitlebar: jest.fn(),
  attachTitlebarToWindow: jest.fn(),
}));

jest.mock('../main/store', () => {
  const values = new Map<string, unknown>();
  return {
    __esModule: true,
    default: {
      get: (k: string) => values.get(k),
      set: (k: string, v: unknown) => values.set(k, v),
      delete: (k: string) => values.delete(k),
      has: (k: string) => values.has(k),
    },
  };
});

jest.mock('../main/menu', () => ({
  __esModule: true,
  default: jest.fn(() => ({ buildMenu: jest.fn() })),
  save: jest.fn(),
  newFile: jest.fn(),
  openFile: jest.fn(),
}));

// Everything a test needs from the freshly imported module registry.
const boot = async (opts: { ready?: boolean } = {}) => {
  jest.resetModules();
  const electron = (await import('electron')) as unknown as FakeElectron;
  const menu = await import('../main/menu');
  const store = (await import('../main/store')).default;
  const log = (await import('electron-log')).default;
  const titlebar = await import(
    '@jshafto/custom-electron-titlebar-update/main'
  );
  const { autoUpdater } = await import('electron-updater');
  await import('../main/main');
  const state = electron.mockState;
  const flush = () =>
    new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  if (opts.ready !== false) {
    state.resolveReady();
    await flush();
  }
  const win = () => state.windows[state.windows.length - 1];
  const fireIpc = async (channel: string, ...args: unknown[]) => {
    await Promise.all(
      (state.ipc.get(channel) ?? []).map(async (fn) => fn(...args))
    );
  };
  const fireWindow = (event: string, ...args: unknown[]) =>
    Promise.all((win().handlers[event] ?? []).map(async (fn) => fn(...args)));
  const fireApp = async (event: string, ...args: unknown[]) => {
    await Promise.all(
      (state.appHandlers.get(event) ?? []).map(async (fn) => fn(...args))
    );
  };
  return {
    electron,
    state,
    menu,
    store,
    log,
    titlebar,
    autoUpdater,
    flush,
    win,
    fireIpc,
    fireWindow,
    fireApp,
  };
};

// Wraps fs.readFile so a test can wait for the callback main.ts passes (the 'ready-to-show' handler
// returns nothing to await) without any fixed sleep.
const trackReadFile = () => {
  const original = fs.readFile;
  let calls = 0;
  const pending: Promise<void>[] = [];
  const spy = jest.spyOn(fs, 'readFile').mockImplementation(((
    file: string,
    enc: string,
    cb: Handler
  ) => {
    calls += 1;
    pending.push(
      new Promise<void>((resolve) => {
        (original as unknown as Handler)(file, enc, (...args: unknown[]) => {
          try {
            cb(...args);
          } finally {
            resolve();
          }
        });
      })
    );
  }) as never);
  return {
    calls: () => calls,
    settled: async () => {
      await Promise.all(pending);
    },
    restore: () => spy.mockRestore(),
  };
};

const setPlatform = (value: string) => {
  Object.defineProperty(process, 'platform', { value, configurable: true });
};

describe('main process', () => {
  const realPlatform = process.platform;
  const realMinimized = process.env.START_MINIMIZED;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'main-test-'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: realPlatform });
    if (realMinimized === undefined) delete process.env.START_MINIMIZED;
    else process.env.START_MINIMIZED = realMinimized;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('closing the window', () => {
    const closeEvent = () => ({ preventDefault: jest.fn() });

    it('lets a saved document close and clears the document from the store', async () => {
      const { store, state, fireWindow } = await boot();
      store.set('edited', 'false');
      store.set('filename', '/a/zq.midst');
      store.set('baseFilename', 'zq.midst');
      store.set('poem', 'zq');
      store.set('history', '[]');
      store.set('theme', 'dark');
      const event = closeEvent();

      await fireWindow('close', event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(state.windows[0].destroy).not.toHaveBeenCalled();
      expect(
        ['filename', 'baseFilename', 'poem', 'history'].map((k) => store.get(k))
      ).toEqual([undefined, undefined, undefined, undefined]);
      expect(store.get('edited')).toBe('false');
      expect(store.get('theme')).toBe('dark');
    });

    it('does not warn when the document is saved', async () => {
      const { store, electron, fireWindow } = await boot();
      store.set('edited', 'false');
      await fireWindow('close', closeEvent());
      expect(electron.dialog.showMessageBoxSync).not.toHaveBeenCalled();
    });

    it.each([['true'], [undefined], ['']])(
      'holds the window and warns when edited is %p',
      async (edited) => {
        const { store, electron, state, fireWindow } = await boot();
        if (edited !== undefined) store.set('edited', edited);
        store.set('poem', 'zq xv');
        store.set('filename', '/a/zq.midst');
        state.dialogResponse = 1;
        const event = closeEvent();

        await fireWindow('close', event);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(electron.dialog.showMessageBoxSync).toHaveBeenCalledWith(
          state.windows[0],
          expect.objectContaining({
            type: 'warning',
            buttons: ['Quit Anyway', 'Cancel'],
            // Return must never be the button that discards the poem (#40).
            defaultId: 1,
            cancelId: 1,
          })
        );
        // Cancel: nothing lost, window stays.
        expect(store.get('poem')).toBe('zq xv');
        expect(store.get('filename')).toBe('/a/zq.midst');
        expect(state.windows[0].destroy).not.toHaveBeenCalled();
      }
    );

    it('keeps the unsaved document in the store when the poet cancels', async () => {
      const { store, state, fireWindow } = await boot();
      store.set('edited', 'true');
      store.set('poem', 'zq');
      store.set('history', '["xv"]');
      state.dialogResponse = 1;
      await fireWindow('close', closeEvent());
      expect(store.get('poem')).toBe('zq');
      expect(store.get('history')).toBe('["xv"]');
      expect(store.get('edited')).toBe('true');
    });

    it('clears the document meta too, so it cannot reach the next document', async () => {
      const { store, fireWindow } = await boot();
      store.set('edited', 'false');
      store.set('meta', '{"fontSize":3}');

      await fireWindow('close', closeEvent());

      expect(store.get('meta')).toBeUndefined();
    });

    it('clears the document meta on Quit Anyway as well', async () => {
      const { store, state, fireWindow } = await boot();
      store.set('edited', 'true');
      store.set('meta', '{"fontSize":3}');
      state.dialogResponse = 0;

      await fireWindow('close', closeEvent());

      expect(store.get('meta')).toBeUndefined();
    });

    it('keeps the meta of an unsaved document when the poet cancels', async () => {
      const { store, state, fireWindow } = await boot();
      store.set('edited', 'true');
      store.set('meta', '{"fontSize":3}');
      state.dialogResponse = 1;

      await fireWindow('close', closeEvent());

      expect(store.get('meta')).toBe('{"fontSize":3}');
    });

    it('discards the document and destroys the window only on Quit Anyway', async () => {
      const { store, state, fireWindow } = await boot();
      store.set('edited', 'true');
      store.set('filename', '/a/zq.midst');
      store.set('baseFilename', 'zq.midst');
      store.set('poem', 'zq');
      store.set('history', '[]');
      state.dialogResponse = 0;

      await fireWindow('close', closeEvent());

      expect(
        ['filename', 'baseFilename', 'poem', 'history'].map((k) => store.get(k))
      ).toEqual([undefined, undefined, undefined, undefined]);
      expect(store.get('edited')).toBe('false');
      expect(state.windows[0].destroy).toHaveBeenCalledTimes(1);
    });

    it('does not show a dialog for a window that has already closed', async () => {
      const { store, electron, fireWindow } = await boot();
      store.set('edited', 'true');
      store.set('poem', 'zq');
      await fireWindow('closed');
      const event = closeEvent();

      await fireWindow('close', event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(electron.dialog.showMessageBoxSync).not.toHaveBeenCalled();
      expect(store.get('poem')).toBe('zq');
    });
  });

  describe('save, new and open from the renderer', () => {
    it.each([
      ['save-file', 'save', 'darwin', true],
      ['save-file', 'save', 'win32', false],
      ['new-file', 'newFile', 'darwin', true],
      ['new-file', 'newFile', 'win32', false],
      ['button-open-file', 'openFile', 'darwin', true],
      ['button-open-file', 'openFile', 'win32', false],
    ] as const)(
      '%s calls %s with the window on %s',
      async (channel, fn, platform, darwin) => {
        setPlatform(platform);
        const { menu, win, fireIpc } = await boot();
        await fireIpc(channel);
        expect(menu[fn]).toHaveBeenCalledTimes(1);
        expect(menu[fn]).toHaveBeenCalledWith(win(), darwin);
      }
    );

    it('does nothing once the window has closed', async () => {
      const { menu, fireIpc, fireWindow } = await boot();
      await fireWindow('closed');
      await fireIpc('save-file');
      await fireIpc('new-file');
      await fireIpc('button-open-file');
      await fireIpc('app-open', ['/a/zq.midst']);
      expect(menu.save).not.toHaveBeenCalled();
      expect(menu.newFile).not.toHaveBeenCalled();
      expect(menu.openFile).not.toHaveBeenCalled();
    });

    it('app-open opens the file the OS asked for', async () => {
      setPlatform('darwin');
      const { menu, log, win, fireIpc } = await boot();
      await fireIpc('app-open', ['/a/zq.midst']);
      expect(menu.openFile).toHaveBeenCalledWith(win(), true, ['/a/zq.midst']);
      expect(log.info).toHaveBeenCalledWith(
        'os requested open',
        expect.objectContaining({ filename: ['/a/zq.midst'] })
      );
    });
  });

  describe('save menu items', () => {
    it('enable-save enables Save and Save As', async () => {
      const { state, fireIpc } = await boot();
      await fireIpc('enable-save');
      expect(state.menuItems.save.enabled).toBe(true);
      expect(state.menuItems['save-as'].enabled).toBe(true);
    });

    it('disable-save disables Save and Save As again', async () => {
      const { state, fireIpc } = await boot();
      await fireIpc('enable-save');
      await fireIpc('disable-save');
      expect(state.menuItems.save.enabled).toBe(false);
      expect(state.menuItems['save-as'].enabled).toBe(false);
    });

    it('survives a menu that is missing or has no such items', async () => {
      const { electron, state, fireIpc } = await boot();
      electron.app.applicationMenu = undefined;
      await expect(fireIpc('enable-save')).resolves.toBeUndefined();
      await expect(fireIpc('disable-save')).resolves.toBeUndefined();
      electron.app.applicationMenu = {
        getMenuItemById: jest.fn(() => null),
      };
      await expect(fireIpc('enable-save')).resolves.toBeUndefined();
      await expect(fireIpc('disable-save')).resolves.toBeUndefined();
      expect(state.menuItems.save.enabled).toBe(false);
    });

    it('does nothing once the window has closed', async () => {
      const { state, fireIpc, fireWindow } = await boot();
      await fireWindow('closed');
      await fireIpc('enable-save');
      expect(state.menuItems.save.enabled).toBe(false);
    });
  });

  describe('opening a file at launch', () => {
    const currentFile = (text: string) =>
      `midstVersion: 1\n${JSON.stringify({ text, history: [] })}`;
    const oldFile = (html: string) =>
      JSON.stringify({
        editorTimelineFrames: [
          { content: html, lineNumber: '0', timestamp: 1605903809127 },
        ],
        meta: {},
      });

    it('holds a path requested before the window exists and opens it once, when the window is ready to show', async () => {
      const file = path.join(dir, 'zq.midst');
      fs.writeFileSync(file, currentFile('<p>zq</p>'));
      const reads = trackReadFile();
      const { store, state, win, fireApp, fireWindow } = await boot({
        ready: false,
      });
      await fireApp('open-file', { preventDefault: jest.fn() }, file);
      state.resolveReady();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      await fireWindow('ready-to-show');
      await reads.settled();

      expect(store.get('poem')).toBe('<p>zq</p>');
      expect(store.get('filename')).toBe(file);
      expect(store.get('baseFilename')).toBe('zq.midst');
      expect(win().webContents.send).toHaveBeenCalledWith(
        'open-file',
        '<p>zq</p>',
        [],
        'zq.midst'
      );

      // The path was consumed: a second ready-to-show does not reopen it.
      await fireWindow('ready-to-show');
      expect(reads.calls()).toBe(1);
      reads.restore();
    });

    it('reads nothing when no file was requested', async () => {
      const reads = trackReadFile();
      const { store, fireWindow } = await boot();
      await fireWindow('ready-to-show');
      expect(reads.calls()).toBe(0);
      expect(store.get('filename')).toBeUndefined();
      reads.restore();
    });

    it('open-file after the window exists asks the open handler to open it', async () => {
      const { menu, win, fireApp } = await boot();
      const event = { preventDefault: jest.fn() };
      await fireApp('open-file', event, '/a/zq.midst');
      expect(event.preventDefault).toHaveBeenCalled();
      expect(menu.openFile).toHaveBeenCalledWith(win(), expect.any(Boolean), [
        '/a/zq.midst',
      ]);
    });

    it('tells the poet when a current-version file is corrupt and loads nothing', async () => {
      const file = path.join(dir, 'xv.midst');
      fs.writeFileSync(file, 'midstVersion: 1\n{not json');
      const reads = trackReadFile();
      const { store, electron, win, fireApp, fireWindow } = await boot();
      await fireApp('open-file', { preventDefault: jest.fn() }, file);

      await fireWindow('ready-to-show');
      await reads.settled();

      expect(electron.dialog.showMessageBoxSync).toHaveBeenCalledWith(
        win(),
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining(file),
        })
      );
      expect(store.get('poem')).toBeUndefined();
      expect(win().webContents.send).not.toHaveBeenCalled();
      // Path consumed even on failure.
      await fireWindow('ready-to-show');
      expect(reads.calls()).toBe(1);
      reads.restore();
    });

    describe('old-format file', () => {
      const openOld = async (response: number) => {
        const file = path.join(dir, 'zq.midst');
        const original = oldFile('<p>zq</p>');
        fs.writeFileSync(file, original);
        const reads = trackReadFile();
        const booted = await boot();
        booted.state.dialogResponse = response;
        await booted.fireApp('open-file', { preventDefault: jest.fn() }, file);
        await booted.fireWindow('ready-to-show');
        await reads.settled();
        return { ...booted, file, original, reads };
      };

      it('offers Cancel / Convert File, defaulting to Convert', async () => {
        const { electron, win, reads } = await openOld(0);
        expect(electron.dialog.showMessageBoxSync).toHaveBeenCalledWith(
          win(),
          expect.objectContaining({
            type: 'warning',
            buttons: ['Cancel', 'Convert File'],
            defaultId: 1,
            cancelId: 0,
          })
        );
        reads.restore();
      });

      it('Cancel writes nothing, loads nothing and leaves the original alone', async () => {
        const { file, original, store, win, reads, fireWindow } = await openOld(
          0
        );
        expect(fs.readdirSync(dir)).toEqual(['zq.midst']);
        expect(fs.readFileSync(file, 'utf8')).toBe(original);
        expect(store.get('filename')).toBeUndefined();
        expect(win().webContents.send).not.toHaveBeenCalled();
        // Path consumed: the prompt does not come back.
        await fireWindow('ready-to-show');
        expect(reads.calls()).toBe(1);
        reads.restore();
      });

      it('Convert File writes a new file beside the original and opens that', async () => {
        const { file, original, store, win, reads } = await openOld(1);
        const converted = path.join(dir, 'zq-converted.midst');
        expect(fs.readdirSync(dir).sort()).toEqual([
          'zq-converted.midst',
          'zq.midst',
        ]);
        expect(fs.readFileSync(file, 'utf8')).toBe(original);
        const written = fs.readFileSync(converted, 'utf8');
        expect(written.startsWith('midstVersion: 1\n')).toBe(true);
        expect(JSON.parse(written.split('\n')[1]).text).toContain('zq');
        expect(store.get('filename')).toBe(converted);
        expect(store.get('baseFilename')).toBe('zq-converted.midst');
        expect(win().webContents.send).toHaveBeenCalledWith(
          'open-file',
          expect.stringContaining('zq'),
          expect.any(Array),
          'zq-converted.midst'
        );
        reads.restore();
      });

      it('Convert File never replaces an earlier conversion', async () => {
        fs.writeFileSync(path.join(dir, 'zq-converted.midst'), 'earlier work');
        const file = path.join(dir, 'zq.midst');
        fs.writeFileSync(file, oldFile('<p>zq</p>'));
        const reads = trackReadFile();
        const { store, state, fireApp, fireWindow } = await boot();
        state.dialogResponse = 1;
        await fireApp('open-file', { preventDefault: jest.fn() }, file);
        await fireWindow('ready-to-show');
        await reads.settled();
        expect(
          fs.readFileSync(path.join(dir, 'zq-converted.midst'), 'utf8')
        ).toBe('earlier work');
        expect(store.get('filename')).toBe(
          path.join(dir, 'zq-converted-2.midst')
        );
        reads.restore();
      });
    });
  });

  describe('window creation', () => {
    it('creates one hidden, frameless window and loads index.html', async () => {
      const { state, win } = await boot();
      expect(state.windows).toHaveLength(1);
      expect(win().options).toEqual(
        expect.objectContaining({ show: false, frame: false })
      );
      expect(win().loadURL).toHaveBeenCalledWith(
        expect.stringContaining('index.html')
      );
      expect(win().show).not.toHaveBeenCalled();
    });

    it('creates no window before the app is ready', async () => {
      const { state } = await boot({ ready: false });
      expect(state.windows).toHaveLength(0);
    });

    it('logs and creates no window when the app fails to become ready', async () => {
      const { state, log, flush } = await boot({ ready: false });
      state.rejectReady(new Error('zq'));
      await flush();
      expect(state.windows).toHaveLength(0);
      expect(log.error).toHaveBeenCalledWith(
        'app failed to become ready',
        expect.any(Error)
      );
    });

    it('shows the window when ready-to-show fires', async () => {
      delete process.env.START_MINIMIZED;
      const { win, fireWindow } = await boot();
      await fireWindow('ready-to-show');
      expect(win().show).toHaveBeenCalledTimes(1);
      expect(win().minimize).not.toHaveBeenCalled();
    });

    it('minimizes instead of showing when START_MINIMIZED is set', async () => {
      process.env.START_MINIMIZED = '1';
      const { win, fireWindow } = await boot();
      await fireWindow('ready-to-show');
      expect(win().minimize).toHaveBeenCalledTimes(1);
      expect(win().show).not.toHaveBeenCalled();
    });

    it.each([
      ['linux', '256x256.png'],
      ['win32', 'icon.ico'],
    ])('uses the right icon on %s', async (platform, file) => {
      setPlatform(platform);
      const { win } = await boot();
      expect(String(win().options.icon).endsWith(file)).toBe(true);
    });

    it('builds the menu and the titlebar for the window and checks for updates', async () => {
      const { menu, titlebar, autoUpdater, win } = await boot();
      expect(menu.default).toHaveBeenCalledWith(win());
      const builder = jest.mocked(menu.default).mock.results[0].value as {
        buildMenu: jest.Mock;
      };
      expect(builder.buildMenu).toHaveBeenCalledTimes(1);
      expect(titlebar.setupTitlebar).toHaveBeenCalledTimes(1);
      expect(titlebar.attachTitlebarToWindow).toHaveBeenCalledWith(win());
      expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
    });

    it('sends links to the system browser and denies new app windows', async () => {
      const { electron, win } = await boot();
      const [open] = win().webContents.setWindowOpenHandler.mock.calls[0] as [
        Handler
      ];
      expect(open({ url: 'https://example.invalid/zq' })).toEqual({
        action: 'deny',
      });
      expect(electron.shell.openExternal).toHaveBeenCalledWith(
        'https://example.invalid/zq'
      );
    });

    it('creates a new window on activate only when none is visible', async () => {
      const { state, fireApp } = await boot();
      await fireApp('activate', {}, true);
      expect(state.windows).toHaveLength(1);
      await fireApp('activate', {}, false);
      expect(state.windows).toHaveLength(2);
    });

    it('quits when all windows are closed', async () => {
      const { electron, fireApp } = await boot();
      await fireApp('window-all-closed');
      expect(electron.app.quit).toHaveBeenCalledTimes(1);
    });
  });

  describe('other ipc handlers', () => {
    it('ipc-example replies pong on the same channel', async () => {
      const { fireIpc } = await boot();
      const reply = jest.fn();
      await fireIpc('ipc-example', { reply }, 'ping');
      expect(reply).toHaveBeenCalledWith('ipc-example', 'IPC test: pong');
    });

    it('electron-store-get returns the stored value to the renderer', async () => {
      const { store, fireIpc } = await boot();
      store.set('poem', 'zq');
      const event: { returnValue?: unknown } = {};
      await fireIpc('electron-store-get', event, 'poem');
      expect(event.returnValue).toBe('zq');
      const missing: { returnValue?: unknown } = { returnValue: 'stale' };
      await fireIpc('electron-store-get', missing, 'nope');
      expect(missing.returnValue).toBeUndefined();
    });

    it('electron-store-set stores the value', async () => {
      const { store, log, fireIpc } = await boot();
      await fireIpc('electron-store-set', {}, 'poem', 'xv');
      expect(store.get('poem')).toBe('xv');
      expect(log.info).not.toHaveBeenCalledWith(
        'log level changed',
        expect.anything()
      );
    });

    it('electron-store-set of the log level applies it at once', async () => {
      const { store, log, fireIpc } = await boot();
      await fireIpc('electron-store-set', {}, 'logLevel', 'debug');
      expect(store.get('logLevel')).toBe('debug');
      expect(log.transports.file.level).toBe('debug');
      expect(log.transports.console.level).toBe('debug');
      expect(log.info).toHaveBeenCalledWith('log level changed', {
        level: 'debug',
      });
    });

    it('an unrecognised log level falls back to info rather than silencing logs', async () => {
      const { log, fireIpc } = await boot();
      await fireIpc('electron-store-set', {}, 'logLevel', 'loud');
      expect(log.transports.file.level).toBe('info');
      expect(log.info).toHaveBeenCalledWith('log level changed', {
        level: 'info',
      });
    });

    it.each([
      ['error', 'error'],
      ['warn', 'warn'],
      ['debug', 'debug'],
      ['info', 'info'],
      ['anything-else', 'info'],
    ] as const)(
      'log-message at level %s is forwarded to log.%s with a renderer prefix',
      async (level, method) => {
        const { log, fireIpc } = await boot();
        await fireIpc('log-message', {}, level, 'zq');
        expect(log[method]).toHaveBeenCalledWith('[renderer] zq');
        await fireIpc('log-message', {}, level, 'xv', { n: 1 });
        expect(log[method]).toHaveBeenCalledWith('[renderer] xv', { n: 1 });
      }
    );

    it('log-message does not call other levels', async () => {
      const { log, fireIpc } = await boot();
      await fireIpc('log-message', {}, 'warn', 'zq');
      expect(log.error).not.toHaveBeenCalled();
      expect(log.debug).not.toHaveBeenCalled();
      expect(log.info).not.toHaveBeenCalledWith('[renderer] zq');
    });
  });
});
