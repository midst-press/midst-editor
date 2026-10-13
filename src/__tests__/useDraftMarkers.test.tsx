import { act, renderHook } from '@testing-library/react';
import useDraftMarkers, {
  FRAMES_BEFORE_MARKERS,
} from '../renderer/components/DraftMarkers/useDraftMarkers';

// Synthetic names only.

// Stands in for the preload bridge: a store, and the 'open-file' message from the main process.
const install = (meta: unknown) => {
  const values: Record<string, unknown> = {
    meta: meta === undefined ? '' : JSON.stringify(meta),
    edited: 'false',
  };
  const listeners: Record<string, (() => void)[]> = {};
  const removed: string[] = [];
  (window as unknown as { electron: unknown }).electron = {
    store: {
      get: (key: string) => values[key],
      set: (key: string, value: string) => {
        values[key] = value;
      },
    },
    ipcRenderer: {
      on: (channel: string, listener: () => void) => {
        listeners[channel] = [...(listeners[channel] ?? []), listener];
        return () => removed.push(channel);
      },
    },
  };
  return {
    values,
    removed,
    storedMeta: () => JSON.parse(values.meta as string),
    openAnother: (next: unknown) => {
      values.meta = JSON.stringify(next);
      listeners['open-file'].forEach((listener) => listener());
    },
  };
};

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron;
});

const LONG = FRAMES_BEFORE_MARKERS + 10;

describe('useDraftMarkers', () => {
  it('shows the markers of the stored document that fall inside its history', () => {
    install({
      draftMarkers: [
        { index: 3, name: 'zq' },
        { index: 999, name: 'xv' },
      ],
    });
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    expect(result.current.markers).toEqual([{ index: 3, label: 'zq' }]);
  });

  it('creates, renames and deletes, storing each change, marking the document unsaved and saving', () => {
    const bridge = install(undefined);
    const save = jest.fn();
    const { result } = renderHook(() => useDraftMarkers(LONG, save));

    let accepted: boolean | undefined;
    act(() => {
      accepted = result.current.create(20);
    });
    expect(accepted).toBe(true);
    expect(result.current.markers).toEqual([{ index: 20, label: 'Draft 1' }]);
    expect(bridge.storedMeta().draftMarkers).toEqual([
      { index: 20, defaultName: 'Draft 1' },
    ]);
    expect(bridge.values.edited).toBe('true');
    expect(save).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.rename(20, 'zq');
    });
    expect(result.current.markers).toEqual([{ index: 20, label: 'zq' }]);
    expect(save).toHaveBeenCalledTimes(2);

    bridge.values.edited = 'false';
    act(() => {
      result.current.remove(20);
    });
    expect(result.current.markers).toEqual([]);
    expect(bridge.storedMeta()).toEqual({
      draftMarkers: [],
      highestDraftNumber: 1,
    });
    expect(bridge.values.edited).toBe('true');
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('allows a marker only once the poem has more than 50 recorded changes', () => {
    const bridge = install(undefined);
    const save = jest.fn();
    const short = renderHook(() =>
      useDraftMarkers(FRAMES_BEFORE_MARKERS, save)
    );
    expect(short.result.current.canCreateAt(10)).toBe(false);
    act(() => {
      expect(short.result.current.create(10)).toBe(false);
    });
    expect(bridge.values.meta).toBe('');
    expect(save).not.toHaveBeenCalled();

    const longer = renderHook(() =>
      useDraftMarkers(FRAMES_BEFORE_MARKERS + 1, save)
    );
    expect(longer.result.current.canCreateAt(10)).toBe(true);
  });

  it('allows one marker per moment, and only inside the history', () => {
    install({ draftMarkers: [{ index: 5, defaultName: 'Draft 1' }] });
    const save = jest.fn();
    const { result } = renderHook(() => useDraftMarkers(LONG, save));
    expect(result.current.canCreateAt(5)).toBe(false);
    expect(result.current.canCreateAt(6)).toBe(true);
    expect(result.current.canCreateAt(LONG - 1)).toBe(true);
    expect(result.current.canCreateAt(LONG)).toBe(false);
    expect(result.current.canCreateAt(-1)).toBe(false);
    act(() => {
      expect(result.current.create(5)).toBe(false);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('shows the newly opened document, and changes that one', () => {
    const bridge = install({ draftMarkers: [{ index: 5, name: 'zq' }] });
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    act(() =>
      bridge.openAnother({
        title: 'qz',
        draftMarkers: [{ index: 8, name: 'xv' }],
      })
    );
    expect(result.current.markers).toEqual([{ index: 8, label: 'xv' }]);
    act(() => {
      result.current.remove(8);
    });
    expect(bridge.storedMeta()).toEqual({
      title: 'qz',
      draftMarkers: [],
      highestDraftNumber: 0,
    });
  });

  it('shows nothing and changes nothing when the stored meta cannot be read', () => {
    const bridge = install(undefined);
    bridge.values.meta = '{zq';
    const save = jest.fn();
    const { result } = renderHook(() => useDraftMarkers(LONG, save));
    expect(result.current.markers).toEqual([]);
    act(() => {
      expect(result.current.create(3)).toBe(false);
    });
    expect(bridge.values.meta).toBe('{zq');
    expect(save).not.toHaveBeenCalled();
  });

  it('stops listening for opened documents when it is no longer shown', () => {
    const bridge = install(undefined);
    const { unmount } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    unmount();
    expect(bridge.removed).toEqual(['open-file']);
  });
});
