/** @jest-environment node */

// Synthetic values only. The mock records what the store is constructed with, and holds its values in
// a Map, so what the module does to a profile at load can be read back.
jest.mock('electron-store', () => ({
  __esModule: true,
  default: class MockStore {
    static instances: unknown[] = [];

    static seed: Record<string, unknown> = {};

    options: unknown;

    values: Map<string, unknown>;

    constructor(options?: unknown) {
      this.options = options;
      this.values = new Map(Object.entries(MockStore.seed));
      MockStore.instances.push(this);
    }

    has(key: string) {
      return this.values.has(key);
    }

    get(key: string) {
      return this.values.get(key);
    }

    set(key: string, value: unknown) {
      this.values.set(key, value);
    }

    delete(key: string) {
      this.values.delete(key);
    }
  },
}));

jest.mock('electron-log', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

type Disk = { options: unknown; values: Map<string, unknown> };
type AppStore = typeof import('../main/store').default;

// Load the module against a profile that already holds `seed`. `disk` is what electron-store holds; `store`
// is what the module exports.
const loadStore = (seed: Record<string, unknown> = {}) => {
  let store: AppStore | undefined;
  let instances: Disk[] = [];
  let log: { error: jest.Mock } | undefined;
  jest.isolateModules(() => {
    /* eslint-disable global-require */
    require('electron-store').default.seed = seed;
    store = require('../main/store').default;
    instances = require('electron-store').default.instances;
    log = require('electron-log').default;
    /* eslint-enable global-require */
  });
  return {
    store: store as AppStore,
    disk: instances[0],
    instances,
    log: log as { error: jest.Mock },
  };
};

describe('store at load (edited)', () => {
  it('gives a new profile edited false, so nothing warns about work that does not exist', () => {
    expect(loadStore().disk.values.get('edited')).toBe(false);
  });

  it('gives an empty document edited false too', () => {
    const { disk } = loadStore({ poem: '', history: '[]' });
    expect(disk.values.get('edited')).toBe(false);
  });

  // #10: a build from before `edited` existed stored work without it.
  it.each([
    ['a poem', { poem: '<p>zq</p>' }],
    ['a history', { history: '[{"front":0}]' }],
    // Cyril, review of #189: a shape this editor never writes still counts as work.
    ['a history stored as an array', { history: [{ front: 0 }] }],
    [
      'a poem stored as something other than a string',
      { poem: { text: 'zq' } },
    ],
  ])(
    'leaves edited unset in a profile that holds %s without it, so it still warns',
    (_label, seed) => {
      expect(loadStore(seed).disk.values.has('edited')).toBe(false);
    }
  );

  // #355: profiles from before 0.9.x hold the strings. Cora, review of the design: the first read sees the
  // converted value, with or without work.
  it.each([
    ['true', true],
    ['false', false],
    [true, true],
    [false, false],
    // Anything else counts as unsaved, so it warns: the safe direction.
    ['zq', true],
    ['', true],
    [0, true],
    [null, true],
  ])('reads a stored edited of %p as %p', (stored, read) => {
    [{ poem: '<p>zq</p>', edited: stored }, { edited: stored }].forEach(
      (seed) => {
        const { store, disk } = loadStore(seed);
        expect(disk.values.get('edited')).toBe(read);
        expect(store.get('edited')).toBe(read);
      }
    );
  });

  it('constructs one electron-store', () => {
    expect(loadStore().instances).toHaveLength(1);
  });
});

describe('store reads and writes (#355)', () => {
  it('reads a value of its type as it is', () => {
    const { store, log } = loadStore({ poem: '<p>zq</p>', edited: true });
    expect(store.get('poem')).toBe('<p>zq</p>');
    expect(store.get('edited')).toBe(true);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('reads a missing value as undefined, and logs nothing', () => {
    const { store, log } = loadStore();
    expect(store.get('filename')).toBeUndefined();
    expect(log.error).not.toHaveBeenCalled();
  });

  // Disk is untyped: an older build, or a person, can have put anything under any key.
  it('reads a value of the wrong type as undefined, and logs the key and the types', () => {
    const { store, disk, log } = loadStore({ history: [{ front: 0 }] });
    expect(store.get('history')).toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      'a stored value is not of its type, so it is read as missing',
      { key: 'history', expected: 'string', found: 'object' }
    );
    // Reading changes nothing on disk.
    expect(disk.values.get('history')).toEqual([{ front: 0 }]);
  });

  // #421: main follows `edited` and `baseFilename` through this, whoever wrote them.
  it('tells each listener the key after a write and after a delete, once the disk holds it', () => {
    const { store, disk } = loadStore();
    const heard: [string, unknown][] = [];
    store.onChange((key) => heard.push([key, disk.values.get(key)]));
    store.set('edited', true);
    store.delete('baseFilename');
    expect(heard).toEqual([
      ['edited', true],
      ['baseFilename', undefined],
    ]);
  });

  it('stores the value, logs, and tells the next listener when a listener throws', () => {
    const { store, disk, log } = loadStore();
    const heard: string[] = [];
    store.onChange(() => {
      throw new TypeError('zq');
    });
    store.onChange((key) => heard.push(key));
    expect(() => store.set('edited', true)).not.toThrow();
    expect(() => store.delete('baseFilename')).not.toThrow();
    expect(disk.values.get('edited')).toBe(true);
    expect(heard).toEqual(['edited', 'baseFilename']);
    expect(log.error).toHaveBeenCalledWith(
      'a store listener failed',
      expect.objectContaining({ key: 'edited', name: 'TypeError' })
    );
  });

  it('writes and deletes on disk', () => {
    const { store, disk } = loadStore();
    store.set('poem', '<p>xv</p>');
    store.set('edited', true);
    expect(disk.values.get('poem')).toBe('<p>xv</p>');
    expect(disk.values.get('edited')).toBe(true);
    store.delete('poem');
    expect(disk.values.has('poem')).toBe(false);
  });
});
