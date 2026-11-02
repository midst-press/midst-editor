import log from 'electron-log';
import Store from 'electron-store';
import {
  fitsSchema,
  STORE_TYPES,
  StoreKey,
  StoreSchema,
} from '../shared/storeSchema';

// `edited` is a boolean (#355). Profiles written before that hold it as the string 'true' or 'false', and
// it is read as "no unsaved changes" only when it is `false` (menu.ts handleUnsavedChanges, and the
// window's close handler in main.ts). So at load, before any window exists to read it:
//   - 'true' and 'false' become true and false;
//   - any other value becomes true, so it still warns, the safe direction for a value nobody expected;
//   - a missing value becomes false, but ONLY in a profile that holds no work. A new profile has no
//     value at all, which read as "unsaved changes": the first open, and closing the empty window,
//     warned about work that did not exist. Builds from before `edited` existed (upstream, April to
//     August 2023) stored a poem and its history without it; such a profile keeps no value, and still
//     warns before an open replaces its poem (#10).
/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
type StoreLike = {
  has: (key: string) => boolean;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
};
/* eslint-enable no-unused-vars */
// Work is anything present that is not plainly empty. A value of an unexpected shape (an older build could
// have stored history as an array) counts as work, so the profile keeps warning: the safe direction. This
// reads the store as it is on disk, not through the type checks below, which would hide such a value.
const EMPTY = new Set<unknown>([undefined, '', '[]']);
const holdsWork = (s: StoreLike): boolean =>
  !EMPTY.has(s.get('poem')) || !EMPTY.has(s.get('history'));
export const settleEdited = (s: StoreLike): void => {
  if (!s.has('edited')) {
    if (!holdsWork(s)) s.set('edited', false);
    return;
  }
  const edited = s.get('edited');
  if (typeof edited !== 'boolean') s.set('edited', edited !== 'false');
};

const disk = new Store<Record<string, unknown>>();
settleEdited(disk);

// The store as the app uses it. A key is one of StoreSchema's, and a value is of its type, which the
// compiler checks for every call in this process. What is on disk is not checked by anything, so a read
// whose value is of the wrong type is logged and comes back as undefined, as a missing value does; every
// caller already handles undefined.
const store = {
  get<K extends StoreKey>(key: K): StoreSchema[K] | undefined {
    const value = disk.get(key);
    if (value === undefined || fitsSchema(key, value)) return value;
    log.error('a stored value is not of its type, so it is read as missing', {
      key,
      expected: STORE_TYPES[key],
      found: typeof value,
    });
    return undefined;
  },
  set<K extends StoreKey>(key: K, value: StoreSchema[K]): void {
    disk.set(key, value);
  },
  delete(key: StoreKey): void {
    disk.delete(key);
  },
};

export default store;
