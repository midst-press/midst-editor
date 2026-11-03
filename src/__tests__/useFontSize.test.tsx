import { act, renderHook } from '@testing-library/react';
import type { ElectronHandler } from 'main/preload';
import useFontSize from '../renderer/fontSize/useFontSize';

type Listener = Parameters<ElectronHandler['ipcRenderer']['on']>[1];

let stored: Record<string, unknown>;
let listeners: Record<string, Listener[]>;

beforeEach(() => {
  stored = {};
  listeners = {};
  (window as unknown as { electron: unknown }).electron = {
    store: {
      get: (key: string) => stored[key],
      set: (key: string, value: unknown) => {
        stored[key] = value;
      },
    },
    ipcRenderer: {
      on: (channel: string, listener: Listener) => {
        (listeners[channel] ??= []).push(listener);
        return () => {
          listeners[channel] = listeners[channel].filter((l) => l !== listener);
        };
      },
    },
  };
});

describe('useFontSize', () => {
  it('starts at the stored size, or the default when none is stored', () => {
    stored['font-size'] = '4';
    expect(renderHook(() => useFontSize()).result.current.size).toBe(4);
    delete stored['font-size'];
    expect(renderHook(() => useFontSize()).result.current.size).toBe(2);
  });

  it('steps and stores the size as a string, and stops at 0 and 4 without storing', () => {
    stored['font-size'] = '0';
    const { result } = renderHook(() => useFontSize());
    expect(result.current.canDecrease).toBe(false);
    act(() => result.current.decrease());
    expect(result.current.size).toBe(0);
    expect(stored['font-size']).toBe('0');
    act(() => result.current.increase());
    expect(result.current.size).toBe(1);
    expect(stored['font-size']).toBe('1');

    stored['font-size'] = '4';
    const top = renderHook(() => useFontSize()).result;
    expect(top.current.canIncrease).toBe(false);
    act(() => top.current.increase());
    expect(top.current.size).toBe(4);
    expect(stored['font-size']).toBe('4');
  });

  it('follows set-font-size from the menu, and stops listening on unmount', () => {
    const { result, unmount } = renderHook(() => useFontSize());
    act(() => listeners['set-font-size'].forEach((l) => l('3')));
    expect(result.current.size).toBe(3);
    unmount();
    expect(listeners['set-font-size']).toHaveLength(0);
  });
});
