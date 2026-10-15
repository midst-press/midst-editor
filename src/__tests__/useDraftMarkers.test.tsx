import { act, renderHook } from '@testing-library/react';
import useDraftMarkers, {
  FAILED_LOG,
  FRAMES_BEFORE_MARKERS,
  REFUSED_LOG,
  REREAD_FAILED_LOG,
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
  const logError = jest.fn();
  // set fails every write, or only the write of `setKey` when that is given; get fails every read.
  const failures: { set?: Error; setKey?: string; get?: Error } = {};
  (window as unknown as { electron: unknown }).electron = {
    log: { error: logError },
    store: {
      get: (key: string) => {
        if (failures.get) throw failures.get;
        return values[key];
      },
      set: (key: string, value: string) => {
        if (failures.set && (!failures.setKey || failures.setKey === key))
          throw failures.set;
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
    logError,
    failures,
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

  it('says why a draft cannot be marked: more than 50 changes are needed, so 50 refuses and 51 allows (GitHub #66)', () => {
    install(undefined);
    const save = jest.fn();
    const fifty = renderHook(() =>
      useDraftMarkers(FRAMES_BEFORE_MARKERS, save)
    );
    expect(fifty.result.current.reasonAt(10)).toBe(
      'A draft can be marked once the poem has more than 50 changes. This one has 50.'
    );
    const fiftyOne = renderHook(() =>
      useDraftMarkers(FRAMES_BEFORE_MARKERS + 1, save)
    );
    expect(fiftyOne.result.current.reasonAt(10)).toBeNull();
  });

  it('says which reason applies: a moment that already has a draft, or no moment there', () => {
    install({ draftMarkers: [{ index: 5, defaultName: 'Draft 1' }] });
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    expect(result.current.reasonAt(5)).toBe('This moment already has a draft.');
    expect(result.current.reasonAt(LONG)).toBe(
      'There is no moment here to mark.'
    );
    expect(result.current.reasonAt(6)).toBeNull();
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

  it('success: no error log and no message', () => {
    const bridge = install(undefined);
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    act(() => {
      result.current.create(20);
    });
    act(() => {
      result.current.rename(20, 'zq');
    });
    act(() => {
      result.current.remove(20);
    });
    expect(bridge.logError).not.toHaveBeenCalled();
    expect(result.current.refusal).toBeNull();
  });
});

// Each row is one way a change is refused. `text` is the exact words the poet is given.
const NO_FILE_TEXT =
  'The drafts of this poem could not be read, so nothing was changed.';
const REFUSALS: {
  name: string;
  meta: unknown;
  raw?: string;
  history?: number;
  // eslint-disable-next-line no-unused-vars
  run: (h: ReturnType<typeof useDraftMarkers>) => boolean;
  action: string;
  index: number;
  reason: string;
  text: string;
}[] = [
  {
    name: 'create in a poem with too few changes',
    meta: undefined,
    history: FRAMES_BEFORE_MARKERS,
    run: (h) => h.create(10),
    action: 'create',
    index: 10,
    reason: 'too-few-changes',
    text: 'A draft can be marked once the poem has more than 50 changes. This one has 50.',
  },
  {
    name: 'create before the first moment',
    meta: undefined,
    run: (h) => h.create(-1),
    action: 'create',
    index: -1,
    reason: 'not-a-history-position',
    text: 'There is no moment here to mark.',
  },
  {
    name: 'create past the last moment',
    meta: undefined,
    run: (h) => h.create(LONG),
    action: 'create',
    index: LONG,
    reason: 'not-a-history-position',
    text: 'There is no moment here to mark.',
  },
  {
    name: 'create where a draft already is',
    meta: { draftMarkers: [{ index: 5, defaultName: 'Draft 1' }] },
    run: (h) => h.create(5),
    action: 'create',
    index: 5,
    reason: 'position-has-a-marker',
    text: 'This moment already has a draft.',
  },
  {
    name: 'create when the draft counter cannot go higher',
    meta: { highestDraftNumber: Number.MAX_SAFE_INTEGER },
    run: (h) => h.create(5),
    action: 'create',
    index: 5,
    reason: 'no-draft-number-left',
    text: 'No more drafts can be numbered in this poem.',
  },
  {
    name: 'create when the stored meta is unreadable',
    meta: undefined,
    raw: '{zq',
    run: (h) => h.create(5),
    action: 'create',
    index: 5,
    reason: 'meta-unreadable',
    text: NO_FILE_TEXT,
  },
  {
    name: 'rename when the stored meta is unreadable',
    meta: undefined,
    raw: '{zq',
    run: (h) => h.rename(5, 'xv'),
    action: 'rename',
    index: 5,
    reason: 'meta-unreadable',
    text: NO_FILE_TEXT,
  },
  {
    name: 'delete when the stored meta is unreadable',
    meta: undefined,
    raw: '{zq',
    run: (h) => h.remove(5),
    action: 'delete',
    index: 5,
    reason: 'meta-unreadable',
    text: NO_FILE_TEXT,
  },
  {
    name: 'create when the list of drafts is not a list',
    meta: { draftMarkers: 'zq' },
    run: (h) => h.create(5),
    action: 'create',
    index: 5,
    reason: 'markers-unreadable',
    text: NO_FILE_TEXT,
  },
  {
    name: 'rename a draft that is not there',
    meta: { draftMarkers: [] },
    run: (h) => h.rename(5, 'xv'),
    action: 'rename',
    index: 5,
    reason: 'no-marker-there',
    text: 'That draft is no longer there.',
  },
  {
    name: 'delete a draft that is not there',
    meta: { draftMarkers: [] },
    run: (h) => h.remove(5),
    action: 'delete',
    index: 5,
    reason: 'no-marker-there',
    text: 'That draft is no longer there.',
  },
];

describe('useDraftMarkers: a refused change', () => {
  it.each(REFUSALS)(
    '$name: logs the reason, tells the poet, changes nothing',
    ({ meta, raw, history, run, action, index, reason, text }) => {
      const bridge = install(meta);
      if (raw !== undefined) bridge.values.meta = raw;
      const before = bridge.values.meta;
      const save = jest.fn();
      const length = history ?? LONG;
      const { result } = renderHook(() => useDraftMarkers(length, save));
      let accepted: boolean | undefined;
      act(() => {
        accepted = run(result.current);
      });
      expect(accepted).toBe(false);
      expect(result.current.refusal).toBe(text);
      expect(bridge.logError).toHaveBeenCalledTimes(1);
      expect(bridge.logError).toHaveBeenCalledWith(REFUSED_LOG, {
        reason,
        action,
        index,
        historyLength: length,
      });
      expect(bridge.values.meta).toBe(before);
      expect(bridge.values.edited).toBe('false');
      expect(save).not.toHaveBeenCalled();
    }
  );

  it('logs only reason, action, index and the history length: no marker names or poem text', () => {
    const bridge = install({
      draftMarkers: [
        { index: 5, name: 'zq-private-name', defaultName: 'Draft 1' },
      ],
    });
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    act(() => {
      result.current.create(5);
    });
    const [message, meta] = bridge.logError.mock.calls[0];
    expect(Object.keys(meta).sort()).toEqual([
      'action',
      'historyLength',
      'index',
      'reason',
    ]);
    expect(JSON.stringify([message, meta])).not.toContain('zq-private-name');
  });

  it('clears the message when the next change is accepted', () => {
    install(undefined);
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    act(() => {
      result.current.remove(5);
    });
    expect(result.current.refusal).toBe('That draft is no longer there.');
    act(() => {
      result.current.create(5);
    });
    expect(result.current.refusal).toBeNull();
  });

  it('clears the message when another document is opened', () => {
    const bridge = install(undefined);
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    act(() => {
      result.current.remove(5);
    });
    expect(result.current.refusal).not.toBeNull();
    act(() => bridge.openAnother({}));
    expect(result.current.refusal).toBeNull();
  });
});

const MAYBE_KEPT =
  'Something went wrong while changing this draft. The drafts list shows what was kept.';

describe('useDraftMarkers: a change that throws', () => {
  it.each([
    ['storing the meta', 'set'],
    ['reading the meta', 'get'],
  ] as const)(
    'while %s: logs the error name only, tells the poet, and does not throw',
    (_label, which) => {
      const bridge = install(undefined);
      const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
      const boom = new RangeError('zq-secret-text');
      bridge.failures[which] = boom;
      let accepted: boolean | undefined;
      act(() => {
        accepted = result.current.create(5);
      });
      expect(accepted).toBe(false);
      // When reading fails, reading back after the failure fails too, and is logged as well.
      expect(bridge.logError).toHaveBeenCalledTimes(which === 'get' ? 2 : 1);
      expect(bridge.logError).toHaveBeenNthCalledWith(1, FAILED_LOG, {
        action: 'create',
        index: 5,
        historyLength: LONG,
        errorName: 'RangeError',
      });
      expect(JSON.stringify(bridge.logError.mock.calls)).not.toContain(
        'zq-secret-text'
      );
      expect(result.current.refusal).toBe(MAYBE_KEPT);
    }
  );

  // A change writes the meta, then the unsaved flag, then saves. A throw after the meta was written leaves the
  // new marker in the store, and the next autosave puts it in the file: the list must show it (Cora on #159).
  it.each([
    ['writing the unsaved flag', 'set-edited'],
    ['saving', 'save'],
  ] as const)(
    'a throw while %s, after the marker was stored: the list shows the stored marker',
    (_label, where) => {
      const bridge = install(undefined);
      const save = jest.fn();
      const { result } = renderHook(() => useDraftMarkers(LONG, save));
      const boom = new RangeError('zq-secret-text');
      if (where === 'save')
        save.mockImplementation(() => {
          throw boom;
        });
      else {
        bridge.failures.set = boom;
        bridge.failures.setKey = 'edited';
      }
      let accepted: boolean | undefined;
      act(() => {
        accepted = result.current.create(5);
      });
      expect(accepted).toBe(false);
      // The store holds the marker, and the screen agrees with the store.
      expect(bridge.storedMeta().draftMarkers).toEqual([
        expect.objectContaining({ index: 5 }),
      ]);
      expect(result.current.markers.map((m) => m.index)).toEqual([5]);
      expect(result.current.refusal).toBe(MAYBE_KEPT);
      expect(bridge.logError.mock.calls).toEqual([
        [
          FAILED_LOG,
          {
            action: 'create',
            index: 5,
            historyLength: LONG,
            errorName: 'RangeError',
          },
        ],
      ]);
      expect(JSON.stringify(bridge.logError.mock.calls)).not.toContain(
        'zq-secret-text'
      );
      // The next try at that moment is refused for the right reason: it IS marked.
      expect(result.current.reasonAt(5)).toBe(
        'This moment already has a draft.'
      );
    }
  );

  it('a throw while writing the meta: nothing stored, and the list is unchanged', () => {
    const bridge = install({ draftMarkers: [{ index: 3, name: 'zq' }] });
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    bridge.failures.set = new RangeError('x');
    bridge.failures.setKey = 'meta';
    act(() => {
      result.current.create(5);
    });
    expect(bridge.storedMeta().draftMarkers).toEqual([
      { index: 3, name: 'zq' },
    ]);
    expect(result.current.markers.map((m) => m.index)).toEqual([3]);
    expect(result.current.refusal).toBe(MAYBE_KEPT);
  });

  it('when the store cannot be read back either, that is logged too and the list stays as it was', () => {
    const bridge = install({ draftMarkers: [{ index: 3, name: 'zq' }] });
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    bridge.failures.get = new TypeError('zq-secret-text');
    act(() => {
      result.current.create(5);
    });
    expect(result.current.markers.map((m) => m.index)).toEqual([3]);
    expect(bridge.logError.mock.calls).toEqual([
      [
        FAILED_LOG,
        {
          action: 'create',
          index: 5,
          historyLength: LONG,
          errorName: 'TypeError',
        },
      ],
      [
        REREAD_FAILED_LOG,
        { action: 'create', index: 5, errorName: 'TypeError' },
      ],
    ]);
    expect(JSON.stringify(bridge.logError.mock.calls)).not.toContain(
      'zq-secret-text'
    );
  });

  it('a read-back that throws something other than an Error is logged by its type', () => {
    const bridge = install(undefined);
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    bridge.failures.get = 'zq' as unknown as Error;
    act(() => {
      result.current.create(5);
    });
    expect(bridge.logError).toHaveBeenNthCalledWith(2, REREAD_FAILED_LOG, {
      action: 'create',
      index: 5,
      errorName: 'string',
    });
  });

  it('names the type when what was thrown is not an Error', () => {
    const bridge = install(undefined);
    const { result } = renderHook(() => useDraftMarkers(LONG, jest.fn()));
    bridge.failures.set = 'zq' as unknown as Error;
    act(() => {
      result.current.create(5);
    });
    expect(bridge.logError).toHaveBeenCalledWith(
      FAILED_LOG,
      expect.objectContaining({ errorName: 'string' })
    );
  });
});
