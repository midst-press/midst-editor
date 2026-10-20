// Synthetic content only: invented words, never a poem.
import type { ElectronHandler } from '../main/preload';

const mockIpc = {
  send: jest.fn(),
  sendSync: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  removeListener: jest.fn(),
};
const mockExposeInMainWorld = jest.fn();
const mockTitlebarInstances: {
  options: unknown;
  updateTitle: jest.Mock;
  updateMenuPosition: jest.Mock;
  updateTitleAlignment: jest.Mock;
  updateBackground: jest.Mock;
}[] = [];

jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (...a: unknown[]) => mockExposeInMainWorld(...a),
  },
  ipcRenderer: {
    send: (...a: unknown[]) => mockIpc.send(...a),
    sendSync: (...a: unknown[]) => mockIpc.sendSync(...a),
    on: (...a: unknown[]) => mockIpc.on(...a),
    once: (...a: unknown[]) => mockIpc.once(...a),
    removeListener: (...a: unknown[]) => mockIpc.removeListener(...a),
  },
}));

jest.mock('@jshafto/custom-electron-titlebar-update', () => ({
  TitlebarColor: { fromHex: (hex: string) => ({ hex }) },
  CustomTitlebar: jest.fn().mockImplementation((options: unknown) => {
    const instance = {
      options,
      updateTitle: jest.fn(),
      updateMenuPosition: jest.fn(),
      updateTitleAlignment: jest.fn(),
      updateBackground: jest.fn(),
    };
    mockTitlebarInstances.push(instance);
    return instance;
  }),
}));

const originalPlatform = process.platform;
const setPlatform = (value: string) =>
  Object.defineProperty(process, 'platform', { value, configurable: true });

type Handler = () => void;
let domHandlers: Handler[] = [];

// Loads a fresh copy of the module, capturing its DOMContentLoaded handlers instead of letting
// them pile up on the shared jsdom window.
const loadPreload = () => {
  const spy = jest
    .spyOn(window, 'addEventListener')
    .mockImplementation((type: string, handler: unknown) => {
      if (type === 'DOMContentLoaded') domHandlers.push(handler as Handler);
    });
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    require('../main/preload');
  });
  spy.mockRestore();
  const exposed = mockExposeInMainWorld.mock.calls[0][1] as ElectronHandler;
  return exposed;
};

const fireDomContentLoaded = () => domHandlers.forEach((h) => h());

beforeEach(() => {
  jest.clearAllMocks();
  mockTitlebarInstances.length = 0;
  domHandlers = [];
  document.body.innerHTML = '<p id="zq">xv</p>';
  setPlatform('darwin');
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe('exposure', () => {
  it('exposes the API once under the name "electron"', () => {
    const api = loadPreload();
    expect(mockExposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(mockExposeInMainWorld.mock.calls[0][0]).toBe('electron');
    expect(Object.keys(api).sort()).toEqual(
      ['ipcRenderer', 'log', 'store', 'titlebar', 'versions'].sort()
    );
  });

  it('reports isMac true on darwin and false elsewhere', () => {
    expect(loadPreload().versions.isMac).toBe(true);
    jest.clearAllMocks();
    setPlatform('linux');
    expect(loadPreload().versions.isMac).toBe(false);
  });
});

describe('ipcRenderer.sendMessage', () => {
  it('sends the channel and the args array as one argument', () => {
    const api = loadPreload();
    api.ipcRenderer.sendMessage('set-filename', ['zq', 'xv']);
    expect(mockIpc.send).toHaveBeenCalledTimes(1);
    expect(mockIpc.send).toHaveBeenCalledWith('set-filename', ['zq', 'xv']);
  });
});

describe('ipcRenderer.on', () => {
  it('registers on the channel and forwards args without the event', () => {
    const api = loadPreload();
    const func = jest.fn();
    api.ipcRenderer.on('open-file', func);
    expect(mockIpc.on).toHaveBeenCalledTimes(1);
    const [channel, subscription] = mockIpc.on.mock.calls[0];
    expect(channel).toBe('open-file');

    subscription({ sender: 'event-zq' }, 'xv', 42);
    expect(func).toHaveBeenCalledTimes(1);
    expect(func).toHaveBeenCalledWith('xv', 42);
  });

  it('returns an unsubscribe that removes the very listener it added', () => {
    const api = loadPreload();
    const unsubscribe = api.ipcRenderer.on('save-file', jest.fn());
    const addedListener = mockIpc.on.mock.calls[0][1];
    expect(mockIpc.removeListener).not.toHaveBeenCalled();

    unsubscribe();
    expect(mockIpc.removeListener).toHaveBeenCalledTimes(1);
    expect(mockIpc.removeListener).toHaveBeenCalledWith(
      'save-file',
      addedListener
    );
  });

  it('gives each subscription its own listener', () => {
    const api = loadPreload();
    const first = api.ipcRenderer.on('new-file', jest.fn());
    api.ipcRenderer.on('new-file', jest.fn());
    const [, listenerA] = mockIpc.on.mock.calls[0];
    const [, listenerB] = mockIpc.on.mock.calls[1];
    expect(listenerA).not.toBe(listenerB);

    first();
    expect(mockIpc.removeListener).toHaveBeenCalledWith('new-file', listenerA);
    expect(mockIpc.removeListener).not.toHaveBeenCalledWith(
      'new-file',
      listenerB
    );
  });
});

describe('ipcRenderer.once', () => {
  it('registers once on the channel and forwards args without the event', () => {
    const api = loadPreload();
    const func = jest.fn();
    api.ipcRenderer.once('app-open', func);
    expect(mockIpc.once).toHaveBeenCalledTimes(1);
    const [channel, listener] = mockIpc.once.mock.calls[0];
    expect(channel).toBe('app-open');
    expect(mockIpc.on).not.toHaveBeenCalled();

    listener({ sender: 'event-zq' }, 'xv', 'zq');
    expect(func).toHaveBeenCalledWith('xv', 'zq');
  });

  it('returns an unsubscribe that removes the very listener it added', () => {
    const api = loadPreload();
    const unsubscribe = api.ipcRenderer.once('app-open', jest.fn());
    const [, listener] = mockIpc.once.mock.calls[0];
    expect(mockIpc.removeListener).not.toHaveBeenCalled();

    unsubscribe();
    expect(mockIpc.removeListener).toHaveBeenCalledTimes(1);
    expect(mockIpc.removeListener).toHaveBeenCalledWith('app-open', listener);
  });
});

describe('store', () => {
  it('get reads synchronously by key and returns the main-process value', () => {
    mockIpc.sendSync.mockReturnValue('zq-value');
    const api = loadPreload();
    expect(api.store.get('xv-key')).toBe('zq-value');
    expect(mockIpc.sendSync).toHaveBeenCalledWith(
      'electron-store-get',
      'xv-key'
    );
  });

  it('set sends property and value on the set channel', () => {
    const api = loadPreload();
    api.store.set('xv-key', 'zq-value');
    expect(mockIpc.send).toHaveBeenCalledWith(
      'electron-store-set',
      'xv-key',
      'zq-value'
    );
  });
});

describe('log', () => {
  it.each(['error', 'warn', 'info', 'debug'] as const)(
    '%s sends the level, message and meta on log-message',
    (level) => {
      const api = loadPreload();
      const meta = { zq: 1 };
      api.log[level]('xv message', meta);
      expect(mockIpc.send).toHaveBeenCalledTimes(1);
      expect(mockIpc.send).toHaveBeenCalledWith(
        'log-message',
        level,
        'xv message',
        meta
      );
    }
  );

  it('passes undefined meta when none is given', () => {
    const api = loadPreload();
    api.log.warn('zq only');
    expect(mockIpc.send).toHaveBeenCalledWith(
      'log-message',
      'warn',
      'zq only',
      undefined
    );
  });
});

describe('titlebar.updateTitle', () => {
  it('does nothing before DOMContentLoaded', () => {
    const api = loadPreload();
    expect(() => api.titlebar.updateTitle('zq')).not.toThrow();
    expect(mockTitlebarInstances).toHaveLength(0);
  });

  it('forwards the title to the titlebar once the DOM has loaded', () => {
    const api = loadPreload();
    fireDomContentLoaded();
    api.titlebar.updateTitle('xv title');
    expect(mockTitlebarInstances).toHaveLength(1);
    expect(mockTitlebarInstances[0].updateTitle).toHaveBeenCalledWith(
      'xv title'
    );
  });
});

describe('DOMContentLoaded', () => {
  it('registers handlers without running them at import time', () => {
    loadPreload();
    expect(domHandlers.length).toBeGreaterThan(0);
    expect(mockTitlebarInstances).toHaveLength(0);
    expect(document.querySelector('.svg')).toBeNull();
  });

  it('creates the titlebar with the configured size and colour', () => {
    loadPreload();
    fireDomContentLoaded();
    expect(mockTitlebarInstances).toHaveLength(1);
    expect(mockTitlebarInstances[0].options).toMatchObject({
      backgroundColor: { hex: '#FFF5EE' },
      minHeight: 270,
      minWidth: 400,
    });
  });

  describe('the title bar colour follows the scheme (GitHub #16)', () => {
    let listeners: (() => void)[];
    const scheme = { matches: false };
    beforeEach(() => {
      listeners = [];
      scheme.matches = false;
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: jest.fn((query: string) => ({
          get matches() {
            return query === '(prefers-color-scheme: dark)' && scheme.matches;
          },
          addEventListener: (type: string, fn: () => void) => {
            if (type === 'change') listeners.push(fn);
          },
        })),
      });
    });
    afterEach(() => {
      delete (window as { matchMedia?: unknown }).matchMedia;
    });

    it('starts dark when the dark scheme is in force', () => {
      scheme.matches = true;
      loadPreload();
      fireDomContentLoaded();
      expect(mockTitlebarInstances[0].options).toMatchObject({
        backgroundColor: { hex: '#1F1A1C' },
      });
    });

    it('starts light when it is not', () => {
      loadPreload();
      fireDomContentLoaded();
      expect(mockTitlebarInstances[0].options).toMatchObject({
        backgroundColor: { hex: '#FFF5EE' },
      });
    });

    it('changes colour when the scheme changes, either way', () => {
      loadPreload();
      fireDomContentLoaded();
      const { updateBackground } = mockTitlebarInstances[0];
      scheme.matches = true;
      listeners.forEach((fn) => fn());
      scheme.matches = false;
      listeners.forEach((fn) => fn());
      expect(updateBackground.mock.calls).toEqual([
        [{ hex: '#1F1A1C' }],
        [{ hex: '#FFF5EE' }],
      ]);
    });
  });

  it('leaves menu position and title alignment alone on darwin', () => {
    loadPreload();
    fireDomContentLoaded();
    expect(mockTitlebarInstances[0].updateMenuPosition).not.toHaveBeenCalled();
    expect(
      mockTitlebarInstances[0].updateTitleAlignment
    ).not.toHaveBeenCalled();
  });

  it.each(['linux', 'win32'])(
    'moves the menu to the bottom and the title left on %s',
    (platform) => {
      setPlatform(platform);
      loadPreload();
      fireDomContentLoaded();
      expect(mockTitlebarInstances[0].updateMenuPosition).toHaveBeenCalledWith(
        'bottom'
      );
      expect(
        mockTitlebarInstances[0].updateTitleAlignment
      ).toHaveBeenCalledWith('left');
    }
  );

  it('inserts the logo as the first child of the body', () => {
    loadPreload();
    fireDomContentLoaded();
    const first = document.body.firstElementChild as HTMLElement;
    expect(first.querySelector('svg.svg')).not.toBeNull();
    expect(document.getElementById('zq')).not.toBeNull();
    expect(document.body.children).toHaveLength(2);
  });

  it('does not add the linux class to the logo on darwin', () => {
    loadPreload();
    fireDomContentLoaded();
    expect(
      document.querySelector('.svg')?.classList.contains('svg-linux')
    ).toBe(false);
  });

  it.each(['linux', 'win32'])('adds the svg-linux class on %s', (platform) => {
    setPlatform(platform);
    loadPreload();
    fireDomContentLoaded();
    expect(
      document.querySelector('.svg')?.classList.contains('svg-linux')
    ).toBe(true);
  });
});
