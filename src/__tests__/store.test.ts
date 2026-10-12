/** @jest-environment node */

// Synthetic values only. The mock records what the store is constructed with.
jest.mock('electron-store', () => ({
  __esModule: true,
  default: class MockStore {
    static instances: unknown[] = [];

    options: unknown;

    constructor(options?: unknown) {
      this.options = options;
      MockStore.instances.push(this);
    }
  },
}));

type Recorded = { options: { defaults?: Record<string, unknown> } };

const loadStore = () => {
  let store: Recorded | undefined;
  let instances: Recorded[] = [];
  jest.isolateModules(() => {
    /* eslint-disable global-require */
    store = require('../main/store').default;
    instances = require('electron-store').default.instances;
    /* eslint-enable global-require */
  });
  return { store: store as Recorded, instances };
};

describe('store', () => {
  it('is constructed with edited defaulting to the string "false"', () => {
    const { store } = loadStore();
    expect(store.options.defaults).toEqual({ edited: 'false' });
  });

  it('exports the one instance it constructed', () => {
    const { store, instances } = loadStore();
    expect(instances).toHaveLength(1);
    expect(store).toBe(instances[0]);
  });
});
