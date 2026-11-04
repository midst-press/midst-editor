import { act, renderHook } from '@testing-library/react';
import type { ElectronHandler } from 'main/preload';
import {
  SizeStore,
  usePoemSizeState,
} from '../renderer/fontSize/PoemSizeContext';

// A poem's text size (editor #390, GitHub #105). Synthetic meta only.

type Listener = Parameters<ElectronHandler['ipcRenderer']['on']>[1];

let listeners: Record<string, Listener[]>;
let sent: string[];

const emit = (channel: string, ...args: unknown[]) =>
  act(() => (listeners[channel] ?? []).forEach((l) => l(...(args as []))));

const makeStore = (initial: Record<string, unknown>) => {
  const stored: Record<string, unknown> = { ...initial };
  const store: SizeStore = {
    get: (key) => stored[key],
    set: (key, value) => {
      stored[key] = value;
    },
  };
  return { stored, store };
};

const meta = (stored: Record<string, unknown>) =>
  JSON.parse(stored.meta as string);

beforeEach(() => {
  listeners = {};
  sent = [];
  (window as unknown as { electron: unknown }).electron = {
    ipcRenderer: {
      on: (channel: string, listener: Listener) => {
        (listeners[channel] ??= []).push(listener);
        return () => {
          listeners[channel] = listeners[channel].filter((l) => l !== listener);
        };
      },
      sendMessage: (channel: string) => sent.push(channel),
    },
  };
});

afterEach(() => {
  document.documentElement.style.removeProperty('--poem-size');
});

const poemSize = () =>
  document.documentElement.style.getPropertyValue('--poem-size');

describe('the size a poem opens at', () => {
  it("is the poem's own meta.fontSize, whatever the last size used was", () => {
    const { store } = makeStore({
      meta: JSON.stringify({ fontSize: 24 }),
      'font-size': '11',
    });
    const { result } = renderHook(() => usePoemSizeState(store));
    expect(result.current.size).toBe(24);
    expect(poemSize()).toBe('24px');
  });

  // Violet, 4 Nov: an existing poem without a size of its own, with no size used yet, stays at 16, where it
  // has always been shown, and nothing is written into it. (A new poem has 14 in its meta: newPoemMeta.)
  it('is the last size used for a poem without one, and 16 when none has been used', () => {
    const last = makeStore({ meta: '', 'font-size': '20' }).store;
    expect(renderHook(() => usePoemSizeState(last)).result.current.size).toBe(
      20
    );
    const none = makeStore({ meta: '{}' });
    expect(
      renderHook(() => usePoemSizeState(none.store)).result.current.size
    ).toBe(16);
    expect(poemSize()).toBe('16px');
    expect(none.stored.meta).toBe('{}');
    expect(none.stored['font-size']).toBeUndefined();
  });

  it('keeps a size the steps do not hold, and draws it within the range', () => {
    const odd = makeStore({ meta: JSON.stringify({ fontSize: 13 }) }).store;
    const { result } = renderHook(() => usePoemSizeState(odd));
    expect(result.current.size).toBe(13);
    expect(poemSize()).toBe('13px');
    const big = makeStore({ meta: JSON.stringify({ fontSize: 50 }) }).store;
    renderHook(() => usePoemSizeState(big));
    expect(poemSize()).toBe('36px');
  });

  it('is read again when another poem is opened', () => {
    const { stored, store } = makeStore({
      meta: JSON.stringify({ fontSize: 24 }),
    });
    const { result } = renderHook(() => usePoemSizeState(store));
    stored.meta = JSON.stringify({ fontSize: 11 });
    emit('open-file', '', [], '');
    expect(result.current.size).toBe(11);
  });
});

describe('changing the size', () => {
  it('writes it into the poem, keeps the rest of meta, counts as unsaved, saves, and becomes the last size used', () => {
    const { stored, store } = makeStore({
      meta: JSON.stringify({ fontSize: 14, fontFamily: 'Zqalpha' }),
      'font-size': '20',
      edited: false,
    });
    const { result } = renderHook(() => usePoemSizeState(store));
    act(() => result.current.increase());
    expect(result.current.size).toBe(16);
    expect(meta(stored)).toEqual({ fontSize: 16, fontFamily: 'Zqalpha' });
    expect(stored.edited).toBe(true);
    expect(sent).toEqual(['save-file']);
    expect(stored['font-size']).toBe('16');
    expect(poemSize()).toBe('16px');
  });

  it('writes nothing into a poem without a size until the poet changes it', () => {
    const { stored, store } = makeStore({ meta: '', 'font-size': '20' });
    const { result } = renderHook(() => usePoemSizeState(store));
    expect(stored.meta).toBe('');
    act(() => result.current.decrease());
    expect(meta(stored)).toEqual({ fontSize: 16 });
  });

  it('steps from a size the steps do not hold to the next one', () => {
    const { stored, store } = makeStore({
      meta: JSON.stringify({ fontSize: 13 }),
    });
    const { result } = renderHook(() => usePoemSizeState(store));
    act(() => result.current.decrease());
    expect(meta(stored).fontSize).toBe(12);
  });

  it('stops at 10 and 36, writing nothing and saving nothing', () => {
    const top = makeStore({ meta: JSON.stringify({ fontSize: 36 }) });
    const high = renderHook(() => usePoemSizeState(top.store)).result;
    expect(high.current.canIncrease).toBe(false);
    act(() => high.current.increase());
    expect(top.stored['font-size']).toBeUndefined();

    const bottom = makeStore({ meta: JSON.stringify({ fontSize: 10 }) });
    const low = renderHook(() => usePoemSizeState(bottom.store)).result;
    expect(low.current.canDecrease).toBe(false);
    act(() => low.current.decrease());
    expect(bottom.stored['font-size']).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('leaves a poem whose meta cannot be read alone, size included', () => {
    const { stored, store } = makeStore({
      meta: '[1,2]',
      'font-size': '20',
    });
    const { result } = renderHook(() => usePoemSizeState(store));
    act(() => result.current.increase());
    expect(result.current.size).toBe(20);
    expect(stored.meta).toBe('[1,2]');
    expect(stored['font-size']).toBe('20');
    expect(sent).toEqual([]);
  });

  it("follows the View menu's step-font-size, and stops listening on unmount", () => {
    const { stored, store } = makeStore({
      meta: JSON.stringify({ fontSize: 14 }),
    });
    const { result, unmount } = renderHook(() => usePoemSizeState(store));
    emit('step-font-size', 'up');
    expect(result.current.size).toBe(16);
    emit('step-font-size', 'down');
    emit('step-font-size', 'down');
    expect(meta(stored).fontSize).toBe(12);
    unmount();
    expect(listeners['step-font-size']).toHaveLength(0);
  });
});

it('works with no preload: the size every poem had before #390, and a change does nothing', () => {
  (window as unknown as { electron?: unknown }).electron = undefined;
  const { result } = renderHook(() => usePoemSizeState(undefined));
  expect(result.current.size).toBe(16);
  act(() => result.current.increase());
  expect(result.current.size).toBe(16);
});
