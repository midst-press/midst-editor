/** @jest-environment node */
import path from 'path';

// Synthetic values only. Each test loads logging.ts afresh (the MIDST_LOG_DIR check runs at import),
// so the mocks are rebuilt per load and nothing carries between tests.
jest.mock('electron-log', () => ({
  __esModule: true,
  default: {
    transports: {
      file: { level: 'untouched' },
      console: { level: 'untouched' },
    },
  },
}));
jest.mock('../main/store', () => {
  const values = new Map<string, unknown>();
  return {
    __esModule: true,
    default: {
      get: (k: string) => values.get(k),
      set: (k: string, v: unknown) => values.set(k, v),
    },
  };
});

type Transport = { level: string; resolvePath?: unknown };
type Loaded = {
  mod: typeof import('../main/logging');
  log: { transports: { file: Transport; console: Transport } };
  store: Pick<Map<string, unknown>, 'set'>;
};

const load = (): Loaded => {
  let loaded: Loaded | undefined;
  jest.isolateModules(() => {
    /* eslint-disable global-require */
    loaded = {
      mod: require('../main/logging'),
      log: require('electron-log').default,
      store: require('../main/store').default,
    };
    /* eslint-enable global-require */
  });
  return loaded as Loaded;
};

describe('logging', () => {
  const savedEnv = process.env;

  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.MIDST_LOG_DIR;
  });
  afterEach(() => {
    process.env = savedEnv;
  });

  describe('configuredLevel', () => {
    it('defaults to info when nothing is stored', () => {
      const { mod } = load();
      expect(mod.configuredLevel()).toBe('info');
    });

    // The key is what a person types into the settings file to raise the level, so its spelling
    // is part of the contract, not only the exported constant.
    it('reads the level from the store key "logLevel"', () => {
      const { mod, store } = load();
      store.set('logLevel', 'debug');
      expect(mod.configuredLevel()).toBe('debug');
    });

    it.each(['error', 'warn', 'info', 'verbose', 'debug', 'silly'])(
      'returns the stored level %s',
      (level) => {
        const { mod, store } = load();
        store.set(mod.LOG_LEVEL_KEY, level);
        expect(mod.configuredLevel()).toBe(level);
      }
    );

    it.each([
      ['an unknown string', 'chatty'],
      ['the wrong case', 'DEBUG'],
      ['an empty string', ''],
      ['a number', 3],
      ['null', null],
      ['an object', { level: 'debug' }],
    ])('falls back to info for %s', (_label, value) => {
      const { mod, store } = load();
      store.set(mod.LOG_LEVEL_KEY, value);
      expect(mod.configuredLevel()).toBe('info');
    });
  });

  describe('applyLogLevel', () => {
    it('applies a valid candidate to both transports and returns it', () => {
      const { mod, log, store } = load();
      store.set(mod.LOG_LEVEL_KEY, 'warn');
      expect(mod.applyLogLevel('debug')).toBe('debug');
      expect(log.transports.file.level).toBe('debug');
      expect(log.transports.console.level).toBe('debug');
    });

    it('uses the configured level when no candidate is given', () => {
      const { mod, log, store } = load();
      store.set(mod.LOG_LEVEL_KEY, 'verbose');
      expect(mod.applyLogLevel()).toBe('verbose');
      expect(log.transports.file.level).toBe('verbose');
      expect(log.transports.console.level).toBe('verbose');
    });

    it('uses info when there is neither a candidate nor a stored level', () => {
      const { mod, log } = load();
      expect(mod.applyLogLevel()).toBe('info');
      expect(log.transports.file.level).toBe('info');
      expect(log.transports.console.level).toBe('info');
    });

    it.each([
      ['an unknown string', 'chatty'],
      ['the wrong case', 'Warn'],
      ['a number', 2],
      ['null', null],
    ])('ignores %s as a candidate and uses the configured level', (_l, bad) => {
      const { mod, log, store } = load();
      store.set(mod.LOG_LEVEL_KEY, 'error');
      expect(mod.applyLogLevel(bad)).toBe('error');
      expect(log.transports.file.level).toBe('error');
      expect(log.transports.console.level).toBe('error');
    });

    it('leaves the transports untouched until it is called', () => {
      const { log } = load();
      expect(log.transports.file.level).toBe('untouched');
      expect(log.transports.console.level).toBe('untouched');
    });
  });

  describe('MIDST_LOG_DIR', () => {
    it('points the file transport at <dir>/main.log when set', () => {
      const dir = path.join('some', 'scratch-dir');
      process.env.MIDST_LOG_DIR = dir;
      const { log } = load();
      const resolve = log.transports.file.resolvePath as () => string;
      expect(resolve()).toBe(path.join(dir, 'main.log'));
    });

    it('leaves resolvePath alone when unset', () => {
      const { log } = load();
      expect(log.transports.file.resolvePath).toBeUndefined();
    });

    it('leaves resolvePath alone when set to an empty string', () => {
      process.env.MIDST_LOG_DIR = '';
      const { log } = load();
      expect(log.transports.file.resolvePath).toBeUndefined();
    });
  });
});
