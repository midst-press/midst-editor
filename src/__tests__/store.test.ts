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
  },
}));

type Recorded = { options: unknown; values: Map<string, unknown> };

// Load the module against a profile that already holds `seed`.
const loadStore = (seed: Record<string, unknown> = {}) => {
  let store: Recorded | undefined;
  let instances: Recorded[] = [];
  jest.isolateModules(() => {
    /* eslint-disable global-require */
    require('electron-store').default.seed = seed;
    store = require('../main/store').default;
    instances = require('electron-store').default.instances;
    /* eslint-enable global-require */
  });
  return { store: store as Recorded, instances };
};

describe('store', () => {
  it('gives a new profile edited "false", so nothing warns about work that does not exist', () => {
    const { store } = loadStore();
    expect(store.values.get('edited')).toBe('false');
  });

  it('gives an empty document edited "false" too', () => {
    const { store } = loadStore({ poem: '', history: '[]' });
    expect(store.values.get('edited')).toBe('false');
  });

  // #10: a build from before `edited` existed stored work without it.
  it.each([
    ['a poem', { poem: '<p>zq</p>' }],
    ['a history', { history: '[{"front":0}]' }],
  ])(
    'leaves edited unset in a profile that holds %s without it, so it still warns',
    (_label, seed) => {
      const { store } = loadStore(seed);
      expect(store.values.has('edited')).toBe(false);
    }
  );

  it.each([['true'], ['false']])(
    'leaves an edited of "%s" as it is, with or without work',
    (edited) => {
      [{ poem: '<p>zq</p>', edited }, { edited }].forEach((seed) => {
        const { store } = loadStore(seed);
        expect(store.values.get('edited')).toBe(edited);
      });
    }
  );

  it('exports the one instance it constructed', () => {
    const { store, instances } = loadStore();
    expect(instances).toHaveLength(1);
    expect(store).toBe(instances[0]);
  });
});
