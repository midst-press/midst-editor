/** @jest-environment node */
import { createMarker, deleteMarker } from '../renderer/tracking/draftMarkers';
import {
  changeStoredMarkers,
  readStoredMeta,
} from '../renderer/tracking/markerStore';

// Synthetic names only.

// A store that records every write in order, as the main process would receive them.
const fakeStore = (initial: Record<string, unknown>) => {
  const values = { ...initial };
  const writes: [string, string][] = [];
  return {
    values,
    writes,
    get: (key: string) => values[key],
    set: (key: string, value: string) => {
      values[key] = value;
      writes.push([key, value]);
    },
  };
};

describe('readStoredMeta', () => {
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['null', null],
  ])('gives an empty meta when the stored one is %s', (_what, stored) => {
    expect(readStoredMeta(fakeStore({ meta: stored }))).toEqual({});
  });

  it('gives the stored object', () => {
    const meta = { fontSize: 12, draftMarkers: [{ index: 1, name: 'zq' }] };
    expect(readStoredMeta(fakeStore({ meta: JSON.stringify(meta) }))).toEqual(
      meta
    );
  });

  it.each([
    ['not JSON', '{zq'],
    ['a list', '[1]'],
    ['a number', '7'],
    ['JSON null', 'null'],
    ['not text', { fontSize: 12 }],
  ])('gives null when the stored meta is %s', (_what, stored) => {
    expect(readStoredMeta(fakeStore({ meta: stored }))).toBeNull();
  });
});

describe('changeStoredMarkers', () => {
  it('stores the new meta, marks the document unsaved, then saves, in that order', () => {
    const store = fakeStore({
      meta: JSON.stringify({ fontSize: 12 }),
      edited: 'false',
    });
    const order: string[] = [];
    const { set } = store;
    store.set = (key, value) => {
      order.push(`set ${key}`);
      set(key, value);
    };
    const result = changeStoredMarkers(
      store,
      (meta) => createMarker(meta, 3, 10),
      () => order.push('save')
    );
    expect(result.ok).toBe(true);
    expect(order).toEqual(['set meta', 'set edited', 'save']);
    expect(JSON.parse(store.values.meta as string)).toEqual({
      fontSize: 12,
      draftMarkers: [{ index: 3, defaultName: 'Draft 1' }],
      highestDraftNumber: 1,
    });
    expect(store.values.edited).toBe('true');
  });

  it('counts a delete as an unsaved change too', () => {
    const meta = {
      draftMarkers: [{ index: 3, defaultName: 'Draft 1' }],
      highestDraftNumber: 1,
    };
    const store = fakeStore({ meta: JSON.stringify(meta), edited: 'false' });
    const save = jest.fn();
    expect(changeStoredMarkers(store, (m) => deleteMarker(m, 3), save).ok).toBe(
      true
    );
    expect(store.values.edited).toBe('true');
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.values.meta as string).draftMarkers).toEqual([]);
  });

  it('starts from an empty meta when the document has none', () => {
    const store = fakeStore({ meta: '' });
    changeStoredMarkers(store, (meta) => createMarker(meta, 0, 1), jest.fn());
    expect(JSON.parse(store.values.meta as string).draftMarkers).toHaveLength(
      1
    );
  });

  it('reads the stored meta at the time of the change, not an earlier copy', () => {
    const store = fakeStore({ meta: JSON.stringify({ title: 'zq' }) });
    store.values.meta = JSON.stringify({ title: 'xv' });
    changeStoredMarkers(store, (meta) => createMarker(meta, 0, 1), jest.fn());
    expect(JSON.parse(store.values.meta as string).title).toBe('xv');
  });

  it('writes nothing and does not save when the change is refused', () => {
    const store = fakeStore({
      meta: JSON.stringify({ draftMarkers: [{ index: 3 }] }),
      edited: 'false',
    });
    const save = jest.fn();
    const result = changeStoredMarkers(
      store,
      (meta) => createMarker(meta, 3, 10),
      save
    );
    expect(result).toEqual({ ok: false, reason: 'position-has-a-marker' });
    expect(store.writes).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it('writes nothing and does not save when the stored meta cannot be read', () => {
    const store = fakeStore({ meta: '{zq', edited: 'false' });
    const save = jest.fn();
    const change = jest.fn();
    expect(changeStoredMarkers(store, change, save)).toEqual({
      ok: false,
      reason: 'meta-unreadable',
    });
    expect(change).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });
});
