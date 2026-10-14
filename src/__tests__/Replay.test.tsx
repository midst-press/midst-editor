import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ElectronHandler } from 'main/preload';
import Replay from '../renderer/components/Replay';
import { HistoryContext, TextContext } from '../renderer/context';
import type { ChangeObj } from '../renderer/tracking/utils';

type Listener = Parameters<ElectronHandler['ipcRenderer']['on']>[1];

// Synthetic data only. Step N of the history below shows N + 1 letters 'a'.

const LONG = 60; // more frames than the 50 a poem needs before a draft may be marked
const SHORT = 10;

const makeHistory = (length: number): ChangeObj[] =>
  Array.from({ length }, (_, i) =>
    i === 0
      ? { front: 0, end: 0, inserted: '<p>a</p>', t: new Date(0) }
      : { front: 3 + i, end: 4, inserted: 'a', t: new Date(i * 1000) }
  );

type Call = [string, ...unknown[]];

// Stands in for the preload bridge. `calls` records every call in order.
const installBridge = (seed: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = { edited: 'false', ...seed };
  const calls: Call[] = [];
  const listeners: Record<string, Listener[]> = {};
  const removed: string[] = [];
  (window as unknown as { electron: unknown }).electron = {
    versions: { isMac: true },
    store: {
      get: (key: string) => values[key],
      set: (key: string, value: unknown) => {
        calls.push(['store.set', key, value]);
        values[key] = value;
      },
    },
    ipcRenderer: {
      sendMessage: (channel: string, args: unknown) =>
        calls.push(['send', channel, args]),
      on: (channel: string, listener: Listener) => {
        listeners[channel] = [...(listeners[channel] ?? []), listener];
        return () => {
          removed.push(channel);
          listeners[channel] = listeners[channel].filter((l) => l !== listener);
        };
      },
      once: jest.fn(),
    },
    titlebar: {
      updateTitle: (name: string) => calls.push(['titlebar', name]),
    },
    log: jest.fn(),
  };
  return {
    values,
    calls,
    removed,
    listeners,
    emit: (channel: string, ...args: unknown[]) =>
      act(() => {
        (listeners[channel] ?? []).forEach((l) => l(...args));
      }),
    meta: () => JSON.parse(values.meta as string),
  };
};

const rect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

beforeAll(() => {
  const noLayout = () => rect;
  [Element.prototype, Range.prototype].forEach((proto) => {
    Object.defineProperty(proto, 'getBoundingClientRect', {
      configurable: true,
      value: noLayout,
    });
    Object.defineProperty(proto, 'getClientRects', {
      configurable: true,
      value: () => [],
    });
  });
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => {},
  });
});

let bridge: ReturnType<typeof installBridge>;
let setText: jest.Mock;
let setPoemHistory: jest.Mock;

const mount = (
  history: ChangeObj[] = makeHistory(LONG),
  state: unknown = undefined
) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/replay', state }]}>
      <TextContext.Provider value={{ text: '<p>POEM</p>', setText }}>
        <HistoryContext.Provider
          value={{ poemHistory: history, setPoemHistory }}
        >
          <Routes>
            <Route path="/replay" element={<Replay />} />
            <Route path="/editor" element={<div>EDITOR PAGE</div>} />
          </Routes>
        </HistoryContext.Provider>
      </TextContext.Provider>
    </MemoryRouter>
  );

const shown = (container: HTMLElement) =>
  container.querySelector('.ProseMirror')?.textContent ?? '';
// hidden: the drafts list, when open, hides the page behind it from the accessibility tree.
const slider = () => screen.getByRole('slider', { hidden: true });
const playButton = () =>
  screen.getByTestId('PlayArrowIcon').closest('button') as HTMLButtonElement;
const pauseButton = () =>
  screen.getByTestId('PauseIcon').closest('button') as HTMLButtonElement;
const seek = (value: number) =>
  fireEvent.change(slider(), { target: { value: String(value) } });
// Intervals created and not yet cleared, so a timer left running can be told from the library's own.
const watchIntervals = () => {
  const live = new Set<unknown>();
  const made = global.setInterval;
  const cleared = global.clearInterval;
  jest.spyOn(global, 'setInterval').mockImplementation(((...a: unknown[]) => {
    const id = Reflect.apply(made, global, a);
    live.add(id);
    return id;
  }) as never);
  jest.spyOn(global, 'clearInterval').mockImplementation(((id: unknown) => {
    live.delete(id);
    return Reflect.apply(cleared, global, [id]);
  }) as never);
  return live;
};
const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });
const markDraft = () =>
  fireEvent.click(
    screen.getByRole('button', { name: 'Mark this moment as a draft' })
  );

beforeEach(() => {
  bridge = installBridge({ 'font-size': '2', meta: '' });
  setText = jest.fn();
  setPoemHistory = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('Replay: initial frame and slider', () => {
  it('opens on the last frame, with the slider spanning the whole history', () => {
    const { container } = mount();
    expect(shown(container)).toBe('a'.repeat(LONG));
    expect(slider()).toHaveAttribute('aria-valuemin', '0');
    expect(slider()).toHaveAttribute('aria-valuemax', String(LONG - 1));
    expect(slider()).toHaveValue(String(LONG - 1));
  });

  it('shows nothing and a zero-length slider for an empty history', () => {
    const { container } = mount([]);
    expect(shown(container)).toBe('');
    expect(slider()).toHaveAttribute('aria-valuemax', '0');
  });

  it('offers no playback for an empty history (#111)', () => {
    mount([]);
    expect(playButton()).toBeDisabled();
  });

  it('shows the frame the slider is moved to', () => {
    const { container } = mount();
    seek(9);
    expect(shown(container)).toBe('a'.repeat(10));
    expect(slider()).toHaveValue('9');
    seek(0);
    expect(shown(container)).toBe('a');
  });
});

describe('Replay: playback', () => {
  beforeEach(() => jest.useFakeTimers());

  it('plays forward from the current frame and turns into a pause button', () => {
    const { container } = mount();
    seek(10);
    fireEvent.click(playButton());
    expect(pauseButton()).toBeInTheDocument();
    advance(60 * 5);
    expect(shown(container).length).toBeGreaterThan(11);
    expect(shown(container).length).toBeLessThanOrEqual(16);
  });

  it('stops advancing when paused, and offers play again', () => {
    const { container } = mount();
    seek(10);
    fireEvent.click(playButton());
    advance(60 * 3);
    fireEvent.click(pauseButton());
    const frozen = shown(container);
    expect(playButton()).toBeInTheDocument();
    advance(60 * 20);
    expect(shown(container)).toBe(frozen);
  });

  it('stops by itself on reaching the last frame', () => {
    const live = watchIntervals();
    const { container } = mount();
    seek(LONG - 4);
    fireEvent.click(playButton());
    advance(60 * 10);
    expect(shown(container)).toBe('a'.repeat(LONG));
    expect(slider()).toHaveValue(String(LONG - 1));
    expect(playButton()).toBeInTheDocument();
    expect(live.size).toBe(0);
    // It stopped ON the last frame, not past it: a draft marked now is at the last index.
    markDraft();
    expect(bridge.meta().draftMarkers).toEqual([
      { index: LONG - 1, defaultName: 'Draft 1' },
    ]);
  });

  it('plays from the start when started on the last frame, after a 250 ms wait', () => {
    const { container } = mount();
    fireEvent.click(playButton());
    expect(shown(container)).toBe('a');
    advance(249);
    expect(shown(container)).toBe('a');
    advance(1 + 60 * 3);
    expect(shown(container).length).toBeGreaterThan(1);
    expect(shown(container).length).toBeLessThan(10);
  });

  it('keeps playing past a seek made during playback', () => {
    const { container } = mount();
    seek(10);
    fireEvent.click(playButton());
    advance(60);
    seek(30);
    advance(60 * 2);
    expect(shown(container).length).toBeGreaterThanOrEqual(31);
  });

  it('starts and stops playback from Space and Enter, and ignores them in a text field', () => {
    mount();
    seek(10);
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(pauseButton()).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(playButton()).toBeInTheDocument();
    const field = document.createElement('input');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: ' ' });
    expect(playButton()).toBeInTheDocument();
    field.remove();
  });

  it('stays paused when paused during the wait before playing from the start (#110)', () => {
    const { container } = mount();
    fireEvent.click(playButton());
    advance(100);
    fireEvent.click(pauseButton());
    advance(150 + 60 * 5);
    expect(shown(container)).toBe('a');
    expect(playButton()).toBeInTheDocument();
  });

  it('leaves no timer running once unmounted during the wait before playing from the start (#110)', () => {
    const live = watchIntervals();
    const view = mount();
    fireEvent.click(playButton());
    advance(100);
    view.unmount();
    advance(500);
    expect(live.size).toBe(0);
  });

  it('leaves no timer running once unmounted after playback has started', () => {
    const live = watchIntervals();
    const view = mount();
    seek(10);
    fireEvent.click(playButton());
    advance(120);
    expect(live.size).toBe(1);
    view.unmount();
    expect(live.size).toBe(0);
  });
});

describe('Replay: text size', () => {
  it('starts at the stored size', () => {
    bridge = installBridge({ 'font-size': '4', meta: '' });
    const { container } = mount();
    expect(container.querySelector('.ReplayContainer')).toHaveClass('size-4');
    expect(
      screen.getByRole('button', { name: 'Increase text size' })
    ).toBeDisabled();
  });

  it.each([[undefined], [''], ['9'], ['abc']])(
    'uses the default size 2 when the stored size is %p',
    (stored) => {
      bridge = installBridge({ 'font-size': stored, meta: '' });
      const { container } = mount();
      expect(container.querySelector('.ReplayContainer')).toHaveClass('size-2');
    }
  );

  it('accepts a stored 0 as the smallest size', () => {
    bridge = installBridge({ 'font-size': 0, meta: '' });
    const { container } = mount();
    expect(container.querySelector('.ReplayContainer')).toHaveClass('size-0');
    expect(
      screen.getByRole('button', { name: 'Decrease text size' })
    ).toBeDisabled();
  });

  it('stores each step up and down as a string', () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Increase text size' }));
    expect(container.querySelector('.ReplayContainer')).toHaveClass('size-3');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease text size' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease text size' }));
    expect(container.querySelector('.ReplayContainer')).toHaveClass('size-1');
    expect(bridge.calls).toEqual([
      ['store.set', 'font-size', '3'],
      ['store.set', 'font-size', '2'],
      ['store.set', 'font-size', '1'],
    ]);
  });

  it('stops at 4 and at 0 without storing anything past the limit', () => {
    bridge = installBridge({ 'font-size': '3', meta: '' });
    mount();
    const up = screen.getByRole('button', { name: 'Increase text size' });
    const down = screen.getByRole('button', { name: 'Decrease text size' });
    fireEvent.click(up);
    expect(up).toBeDisabled();
    fireEvent.click(up);
    for (let i = 0; i < 6; i += 1) fireEvent.click(down);
    expect(down).toBeDisabled();
    expect(bridge.calls.map((c) => c[2])).toEqual(['4', '3', '2', '1', '0']);
  });

  it('follows a size chosen from the application menu', () => {
    const { container } = mount();
    bridge.emit('set-font-size', 4);
    expect(container.querySelector('.ReplayContainer')).toHaveClass('size-4');
  });
});

describe('Replay: marking a draft', () => {
  it('records a marker at the frame shown, counts it as unsaved, then saves', () => {
    mount();
    seek(20);
    markDraft();
    expect(bridge.meta().draftMarkers).toEqual([
      { index: 20, defaultName: 'Draft 1' },
    ]);
    expect(bridge.values.edited).toBe('true');
    const keys = bridge.calls.map((c) => c[1]);
    expect(keys).toEqual(['meta', 'edited', 'poem', 'history', 'save-file']);
  });

  it('stores the poem and history it shows before requesting the save', () => {
    const history = makeHistory(LONG);
    mount(history);
    markDraft();
    const sendAt = bridge.calls.findIndex(
      (c) => c[0] === 'send' && c[1] === 'save-file'
    );
    expect(sendAt).toBeGreaterThan(-1);
    expect(bridge.calls[sendAt]).toEqual(['send', 'save-file', []]);
    const poemAt = bridge.calls.findIndex((c) => c[1] === 'poem');
    const historyAt = bridge.calls.findIndex((c) => c[1] === 'history');
    expect(poemAt).toBeLessThan(sendAt);
    expect(historyAt).toBeLessThan(sendAt);
    expect(bridge.calls[poemAt][2]).toBe('<p>POEM</p>');
    expect(bridge.calls[historyAt][2]).toBe(JSON.stringify(history));
  });

  it('marks the last frame when the poem is first opened', () => {
    mount();
    markDraft();
    expect(bridge.meta().draftMarkers).toEqual([
      { index: LONG - 1, defaultName: 'Draft 1' },
    ]);
  });

  it('pauses playback, opens the drafts list with the new name ready to type', () => {
    jest.useFakeTimers();
    mount();
    seek(10);
    fireEvent.click(playButton());
    advance(60);
    markDraft();
    expect(playButton()).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Draft name' })).toHaveValue(
      'Draft 1'
    );
  });

  it('refuses a second marker on the same frame', () => {
    mount();
    seek(20);
    markDraft();
    // The drafts list has opened over the page, which hides it from the accessibility tree.
    expect(
      screen.getByRole('button', {
        name: 'Mark this moment as a draft',
        hidden: true,
      })
    ).toBeDisabled();
    expect(bridge.meta().draftMarkers).toHaveLength(1);
  });

  it('refuses markers in a short history', () => {
    mount(makeHistory(SHORT));
    expect(
      screen.getByRole('button', { name: 'Mark this moment as a draft' })
    ).toBeDisabled();
    expect(bridge.calls).toEqual([]);
  });

  it('refuses a marker when the stored meta cannot be read, changing nothing', () => {
    bridge = installBridge({ 'font-size': '2', meta: '[1,2]' });
    mount();
    markDraft();
    expect(bridge.calls).toEqual([]);
    expect(screen.queryByRole('textbox', { name: 'Draft name' })).toBeNull();
  });
});

describe('Replay: drafts list', () => {
  const seeded = {
    'font-size': '2',
    meta: JSON.stringify({
      draftMarkers: [
        { index: 5, name: 'zq' },
        { index: 40, name: 'xv' },
        { index: 999, name: 'outside' },
      ],
    }),
  };

  it('opens from the Drafts button and lists the markers inside the history, newest first', () => {
    bridge = installBridge(seeded);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    const names = Array.from(
      document.querySelectorAll('.DraftDrawer .draft-name')
    ).map((b) => b.textContent);
    expect(names).toEqual(['xv', 'zq']);
  });

  it('says so when there are no drafts', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    expect(screen.getByText('No drafts marked yet.')).toBeInTheDocument();
  });

  it('jumps to the frame of a chosen draft', () => {
    bridge = installBridge(seeded);
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    fireEvent.click(screen.getByRole('button', { name: 'zq' }));
    expect(shown(container)).toBe('a'.repeat(6));
    expect(slider()).toHaveValue('5');
  });

  it('pauses playback when jumping', () => {
    jest.useFakeTimers();
    bridge = installBridge(seeded);
    const { container } = mount();
    seek(10);
    fireEvent.click(playButton());
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    fireEvent.click(screen.getByRole('button', { name: 'xv' }));
    expect(playButton()).toBeInTheDocument();
    advance(60 * 10);
    expect(shown(container)).toBe('a'.repeat(41));
  });

  it('renames a draft, storing the name and saving', () => {
    bridge = installBridge(seeded);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename draft' })[1]);
    const field = screen.getByRole('textbox', { name: 'Draft name' });
    fireEvent.change(field, { target: { value: 'renamed' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(
      bridge.meta().draftMarkers.find((m: { index: number }) => m.index === 5)
        .name
    ).toBe('renamed');
    expect(bridge.values.edited).toBe('true');
    expect(bridge.calls.at(-1)).toEqual(['send', 'save-file', []]);
  });

  it('deletes a draft, storing the change and saving', () => {
    bridge = installBridge(seeded);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete draft' })[0]);
    expect(
      bridge.meta().draftMarkers.map((m: { index: number }) => m.index)
    ).toEqual([5, 999]);
    expect(bridge.values.edited).toBe('true');
    expect(bridge.calls.at(-1)).toEqual(['send', 'save-file', []]);
  });

  it('opens already naming the draft the editor sent the poet to name', () => {
    bridge = installBridge(seeded);
    mount(makeHistory(LONG), { nameDraftAt: 40 });
    expect(screen.getByRole('textbox', { name: 'Draft name' })).toHaveValue(
      'xv'
    );
  });

  it('does not open the list when no draft is to be named', () => {
    bridge = installBridge(seeded);
    mount();
    expect(document.querySelector('.DraftDrawer')).toBeNull();
  });

  it('can hide the markers and their names on the timeline', () => {
    bridge = installBridge(seeded);
    const { container } = mount();
    expect(container.querySelectorAll('.MuiSlider-mark')).toHaveLength(2);
    expect(container.querySelectorAll('.MuiSlider-markLabel')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show their names' }));
    expect(container.querySelectorAll('.MuiSlider-markLabel')).toHaveLength(0);
    expect(container.querySelectorAll('.MuiSlider-mark')).toHaveLength(2);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Show markers on the timeline' })
    );
    expect(container.querySelectorAll('.MuiSlider-mark')).toHaveLength(0);
  });

  it('closes with Escape, staying on the replay screen', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    const panel = document.querySelector('.DraftDrawer') as HTMLElement;
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByText('EDITOR PAGE')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Drafts', hidden: false })
    ).toBeInTheDocument();
  });

  it('leaves playback keys alone while the list is open', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(screen.getByTestId('PlayArrowIcon')).toBeInTheDocument();
    expect(screen.queryByText('EDITOR PAGE')).toBeNull();
  });
});

describe('Replay: going back to the editor', () => {
  it('"Edit" links to the editor and, by itself, stores and sends nothing', () => {
    mount();
    const edit = screen.getByRole('button', { name: 'Edit' });
    expect(edit.closest('a')).toHaveAttribute('href', '/editor');
    fireEvent.click(edit);
    expect(screen.getByText('EDITOR PAGE')).toBeInTheDocument();
    expect(bridge.calls).toEqual([]);
  });

  it('Escape goes back to the editor', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByText('EDITOR PAGE')).toBeInTheDocument();
  });

  it('the application menu toggle goes back to the editor', () => {
    mount();
    bridge.emit('toggle-edit-mode');
    expect(screen.getByText('EDITOR PAGE')).toBeInTheDocument();
  });

  it('opening a file hands its poem and history over, titles the window, and goes to the editor', () => {
    jest.useFakeTimers();
    const live = watchIntervals();
    mount();
    seek(10);
    fireEvent.click(playButton());
    expect(live.size).toBe(1);
    const history = makeHistory(SHORT);
    bridge.emit('open-file', '<p>OTHER</p>', history, 'other.midst');
    expect(setText).toHaveBeenCalledWith('<p>OTHER</p>');
    expect(setPoemHistory).toHaveBeenCalledWith(history);
    expect(bridge.calls).toContainEqual(['titlebar', 'other.midst']);
    expect(screen.getByText('EDITOR PAGE')).toBeInTheDocument();
    expect(live.size).toBe(0);
  });
});

describe('Replay: listeners', () => {
  it('registers its menu listeners and removes every one on unmount', () => {
    const view = mount();
    const registered = Object.keys(bridge.listeners).filter(
      (c) => bridge.listeners[c].length > 0
    );
    expect(registered).toEqual(
      expect.arrayContaining(['open-file', 'toggle-edit-mode', 'set-font-size'])
    );
    view.unmount();
    Object.keys(bridge.listeners).forEach((channel) =>
      expect(bridge.listeners[channel]).toHaveLength(0)
    );
    expect(bridge.removed).toEqual(
      expect.arrayContaining(['open-file', 'toggle-edit-mode', 'set-font-size'])
    );
  });

  it('does not re-register listeners when playback starts and stops', () => {
    jest.useFakeTimers();
    mount();
    seek(10);
    const before = JSON.stringify(
      Object.fromEntries(
        Object.entries(bridge.listeners).map(([k, v]) => [k, v.length])
      )
    );
    const removedBefore = bridge.removed.length;
    fireEvent.click(playButton());
    advance(120);
    fireEvent.click(pauseButton());
    expect(bridge.removed.length).toBe(removedBefore);
    expect(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(bridge.listeners).map(([k, v]) => [k, v.length])
        )
      )
    ).toBe(before);
  });

  it('stops listening for keys on unmount', () => {
    const view = mount();
    view.unmount();
    expect(() =>
      fireEvent.keyDown(document.body, { key: 'Escape' })
    ).not.toThrow();
  });
});
