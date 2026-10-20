// Draft markers in the stored document. The main process holds a document's `meta` as a JSON string
// under the store key 'meta' and writes it into the file on save; this reads it, changes it with the
// rules in draftMarkers.ts, and writes it back.
//
// The stored meta is read afresh for every change, never taken from what a component last saw, so a
// change is always made to the document that is open now.
import { MarkerResult, Meta } from './draftMarkers';

/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
export interface MetaStore {
  get(key: string): unknown;
  set(key: string, value: string): void;
}
/* eslint-enable no-unused-vars */

// The stored meta, `{}` when the document has none, or null when what is stored cannot be read as an
// object. Null means: change nothing.
export const readStoredMeta = (store: MetaStore): Meta | null => {
  const raw = store.get('meta');
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'string') return null;
  try {
    const meta = JSON.parse(raw);
    return typeof meta === 'object' && meta !== null && !Array.isArray(meta)
      ? meta
      : null;
  } catch (unreadable) {
    return null;
  }
};

export type StoredChange =
  MarkerResult | { ok: false; reason: 'meta-unreadable' };

// Applies one marker change to the stored document. When the change is accepted the new meta is
// stored, the document is marked as having unsaved changes, and `save` is called. Every accepted
// change counts as unsaved, a delete included (the original editor left deletes out).
export const changeStoredMarkers = (
  store: MetaStore,
  // eslint-disable-next-line no-unused-vars
  change: (meta: Meta) => MarkerResult,
  save: () => void
): StoredChange => {
  const meta = readStoredMeta(store);
  if (meta === null) return { ok: false, reason: 'meta-unreadable' };
  const result = change(meta);
  if (!result.ok) return result;
  store.set('meta', JSON.stringify(result.meta));
  store.set('edited', JSON.stringify(true));
  save();
  return result;
};
