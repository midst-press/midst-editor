// Every key the app keeps in its store, and the type of its value (#355). The main process, the preload
// and the renderer all type their store calls with it, so a key that is not here, or a value of the wrong
// type, does not compile.
//
// The compiler cannot see the two places data enters untyped: what the renderer sends over IPC, and what
// is on disk, written by an older build or by hand. STORE_TYPES is the same schema at run time, and both
// are checked against it.
//
// Most values are strings, some of them JSON (history, meta) and some of them a number or a boolean
// written as text (font-size, spellcheck, the Replay settings). Those are typed as what is stored today.
export interface StoreSchema {
  filename: string;
  baseFilename: string;
  poem: string;
  history: string;
  meta: string;
  edited: boolean;
  'font-size': string;
  spellcheck: string;
  appearance: string;
  language: string;
  lastFolder: string;
  recoveryId: string;
  logLevel: string;
  'replay-show-timestamp': string;
  'replay-autoscroll': string;
}

export type StoreKey = keyof StoreSchema;

type TypeName<T> = T extends boolean ? 'boolean' : 'string';

// A mapped type, so a key added to StoreSchema without an entry here, or with the wrong type name, does
// not compile.
export const STORE_TYPES: {
  readonly [K in StoreKey]: TypeName<StoreSchema[K]>;
} = {
  filename: 'string',
  baseFilename: 'string',
  poem: 'string',
  history: 'string',
  meta: 'string',
  edited: 'boolean',
  'font-size': 'string',
  spellcheck: 'string',
  appearance: 'string',
  language: 'string',
  lastFolder: 'string',
  recoveryId: 'string',
  logLevel: 'string',
  'replay-show-timestamp': 'string',
  'replay-autoscroll': 'string',
};

export const isStoreKey = (key: unknown): key is StoreKey =>
  typeof key === 'string' &&
  Object.prototype.hasOwnProperty.call(STORE_TYPES, key);

// STORE_TYPES holds only 'string' and 'boolean', both names typeof gives, which the rule cannot see.
export const fitsSchema = <K extends StoreKey>(
  key: K,
  value: unknown
  // eslint-disable-next-line valid-typeof
): value is StoreSchema[K] => typeof value === STORE_TYPES[key];

// The keys that hold the document the window has open, removed together when it is closed.
export const DOCUMENT_KEYS: readonly StoreKey[] = [
  'filename',
  'baseFilename',
  'poem',
  'history',
  'meta',
];

// The keys that hold the poem itself. A refused write of one of these means the poet's latest work is
// not being kept, so they are told, not only the log.
export const WORK_KEYS: ReadonlySet<StoreKey> = new Set<StoreKey>([
  'poem',
  'history',
  'meta',
]);
