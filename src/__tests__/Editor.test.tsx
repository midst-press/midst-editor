import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Editor as TipTapEditor } from '@tiptap/core';
import type { ElectronHandler } from 'main/preload';
import Editor from '../renderer/components/Editor';
import { REFUSED_LOG } from '../renderer/components/DraftMarkers/useDraftMarkers';
import { HistoryContext, RETURN_TO, TextContext } from '../renderer/context';
import { ChangeObj } from '../renderer/tracking/utils';

type Listener = Parameters<ElectronHandler['ipcRenderer']['on']>[1];

// Synthetic text only.

type Call = { kind: string; args: unknown[] };

// Stands in for the preload bridge: every call recorded in order, an in-memory store, and the
// messages the main process can send ('open-file', 'toggle-spellcheck', ...).
const installBridge = (seed: Record<string, unknown> = {}, isMac = false) => {
  const values: Record<string, unknown> = { ...seed };
  const calls: Call[] = [];
  const listeners: Record<string, Listener[]> = {};
  const removed: string[] = [];
  const record = (kind: string, ...args: unknown[]) =>
    calls.push({ kind, args });
  (window as unknown as { electron: unknown }).electron = {
    versions: { isMac },
    store: {
      get: (key: string) => values[key],
      set: (key: string, value: unknown) => {
        record('store.set', key, value);
        values[key] = value;
      },
    },
    ipcRenderer: {
      sendMessage: (channel: string, args: unknown) =>
        record('send', channel, args),
      on: (channel: string, listener: Listener) => {
        listeners[channel] = [...(listeners[channel] ?? []), listener];
        return () => {
          removed.push(channel);
          listeners[channel] = listeners[channel].filter((l) => l !== listener);
        };
      },
    },
    titlebar: {
      updateTitle: (name: string) => record('title', name),
    },
    log: {
      warn: (m: string) => record('log.warn', m),
      error: (m: string, meta: unknown) => record('log.error', m, meta),
    },
  };
  return {
    values,
    calls,
    removed,
    sends: (channel: string) =>
      calls.filter((c) => c.kind === 'send' && c.args[0] === channel),
    sets: (key: string) =>
      calls.filter((c) => c.kind === 'store.set' && c.args[0] === key),
    index: (kind: string, first: unknown) =>
      calls.findIndex((c) => c.kind === kind && c.args[0] === first),
    clear: () => calls.splice(0, calls.length),
    activeListeners: (channel: string) => (listeners[channel] ?? []).length,
    emit: (channel: string, ...a: unknown[]) =>
      act(() => {
        [...(listeners[channel] ?? [])].forEach((l) => l(...a));
      }),
  };
};

const change = (n: number): ChangeObj => ({
  front: 0,
  end: 0,
  inserted: `c${n}`,
  t: new Date(0),
});

const LONG_HISTORY = Array.from({ length: 60 }, (_, i) => change(i));

function Where() {
  const location = useLocation();
  return (
    <div data-testid="where">
      {location.pathname}
      {location.state ? JSON.stringify(location.state) : ''}
    </div>
  );
}

// Holds text and history as App does, and reports every setter call.
const setPoemHistorySpy = jest.fn();
const setTextSpy = jest.fn();
function Harness({
  initialText,
  initialHistory,
}: {
  initialText: string;
  initialHistory: ChangeObj[];
}) {
  const [text, setText] = useState(initialText);
  const [poemHistory, setPoemHistory] = useState(initialHistory);
  const textValue = useMemo(
    () => ({
      text,
      setText: (t: string) => {
        setTextSpy(t);
        setText(t);
      },
    }),
    [text]
  );
  const historyValue = useMemo(
    () => ({
      poemHistory,
      setPoemHistory: (h: ChangeObj[]) => {
        setPoemHistorySpy(h);
        setPoemHistory(h);
      },
    }),
    [poemHistory]
  );
  return (
    <TextContext.Provider value={textValue}>
      <HistoryContext.Provider value={historyValue}>
        <MemoryRouter initialEntries={['/editor']}>
          <Routes>
            <Route path="/editor" element={<Editor />} />
            <Route path="*" element={<div />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </HistoryContext.Provider>
    </TextContext.Provider>
  );
}

type TipTapDom = HTMLElement & { editor: TipTapEditor };
const proseMirror = () =>
  document.querySelector('.ProseMirror') as unknown as TipTapDom;

// Typing is driven through the editor, as jsdom turns no key event into ProseMirror input.
const typeText = (text: string) =>
  act(() => {
    const { editor } = proseMirror();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(text);
  });

// tiptap focuses on an animation frame.
const settleFocus = () =>
  act(() => {
    jest.advanceTimersByTime(100);
  });

const mount = ({
  initialText = '<p>zq</p>',
  initialHistory = [] as ChangeObj[],
}: { initialText?: string; initialHistory?: ChangeObj[] } = {}) => {
  const view = render(
    <Harness initialText={initialText} initialHistory={initialHistory} />
  );
  // tiptap announces 'create' (which focuses the editor and hands it to the component) from a
  // zero-delay timer.
  act(() => {
    jest.advanceTimersByTime(0);
  });
  return view;
};

beforeAll(() => {
  // jsdom has no layout; ProseMirror asks for these.
  const rect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
  };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () =>
    ({
      item: () => null,
      length: 0,
      [Symbol.iterator]: [][Symbol.iterator],
    } as unknown as DOMRectList);
  Element.prototype.scrollIntoView = jest.fn();
});

let bridge: ReturnType<typeof installBridge>;

beforeEach(() => {
  jest.useFakeTimers();
  setPoemHistorySpy.mockClear();
  setTextSpy.mockClear();
  window.sessionStorage.clear();
  bridge = installBridge({ 'font-size': '2', spellcheck: 'false', meta: '' });
});

afterEach(() => {
  jest.useRealTimers();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('Editor: content and appearance', () => {
  it('shows the text from the text context', () => {
    mount({ initialText: '<p>zq xv</p>' });
    expect(proseMirror()).toHaveTextContent('zq xv');
  });

  it('uses the stored font size class, and the default when the stored size is not a size', () => {
    bridge = installBridge({ 'font-size': '4' });
    const { unmount } = mount();
    expect(proseMirror()).toHaveClass('size-4');
    unmount();
    bridge = installBridge({ 'font-size': '9' });
    mount();
    expect(proseMirror()).toHaveClass('size-2');
  });

  it('uses the default size when none is stored, and the smallest when 0 is stored', () => {
    bridge = installBridge({});
    const { unmount } = mount();
    expect(proseMirror()).toHaveClass('size-2');
    unmount();
    bridge = installBridge({ 'font-size': '0' });
    mount();
    expect(proseMirror()).toHaveClass('size-0');
  });

  it('picks the tall editor on a Mac and the short one elsewhere', () => {
    const { unmount } = mount();
    expect(proseMirror()).toHaveClass('editor-height-short');
    unmount();
    bridge = installBridge({}, true);
    mount();
    expect(proseMirror()).toHaveClass('editor-height-tall');
  });

  it('turns spellcheck on only when the stored setting is the string "true"', () => {
    const { unmount } = mount();
    expect(proseMirror()).toHaveAttribute('spellcheck', 'false');
    unmount();
    bridge = installBridge({ spellcheck: 'true' });
    mount();
    expect(proseMirror()).toHaveAttribute('spellcheck', 'true');
  });

  it('focuses the editor when it is created', () => {
    mount();
    settleFocus();
    expect(document.activeElement).toBe(proseMirror());
  });

  it('on a Mac, takes focus back when the editor loses it; elsewhere it does not', () => {
    bridge = installBridge({}, true);
    const { unmount } = mount();
    settleFocus();
    act(() => proseMirror().blur());
    settleFocus();
    expect(document.activeElement).toBe(proseMirror());
    unmount();
    bridge = installBridge({}, false);
    mount();
    settleFocus();
    act(() => proseMirror().blur());
    settleFocus();
    expect(document.activeElement).not.toBe(proseMirror());
  });

  it('on a Mac, leaves the focus in the find bar, and gets it back when the bar closes (GitHub #27)', () => {
    bridge = installBridge({}, true);
    mount();
    settleFocus();
    bridge.emit('find-in-poem');
    settleFocus();
    const field = screen.getByRole('textbox', { name: 'Find in the poem' });
    expect(document.activeElement).toBe(field);
    act(() => {
      fireEvent.keyDown(field, { key: 'Escape' });
    });
    settleFocus();
    expect(document.activeElement).toBe(proseMirror());
  });
});

describe('Editor: on entering and leaving', () => {
  it('stores the poem and history, then asks to save, then enables the save menu, on entry', () => {
    mount({ initialText: '<p>zq</p>', initialHistory: [change(1)] });
    expect(bridge.values.poem).toBe('<p>zq</p>');
    expect(bridge.values.history).toBe(JSON.stringify([change(1)]));
    const poem = bridge.index('store.set', 'poem');
    const history = bridge.index('store.set', 'history');
    const save = bridge.index('send', 'save-file');
    const enable = bridge.index('send', 'enable-save');
    expect(poem).toBeGreaterThanOrEqual(0);
    expect(history).toBeGreaterThanOrEqual(0);
    expect(save).toBeGreaterThan(poem);
    expect(save).toBeGreaterThan(history);
    expect(enable).toBeGreaterThan(save);
  });

  it('sends disable-save and removes every listener it registered on unmount', () => {
    const { unmount } = mount();
    expect(bridge.activeListeners('open-file')).toBeGreaterThan(0);
    expect(bridge.activeListeners('toggle-spellcheck')).toBe(1);
    expect(bridge.activeListeners('toggle-edit-mode')).toBe(1);
    expect(bridge.activeListeners('cancel-save')).toBeGreaterThan(0);
    bridge.clear();
    unmount();
    expect(bridge.sends('disable-save')).toHaveLength(1);
    [
      'open-file',
      'toggle-spellcheck',
      'toggle-edit-mode',
      'cancel-save',
      'set-font-size',
      'flush-editor',
    ].forEach((channel) => expect(bridge.activeListeners(channel)).toBe(0));
  });

  it('listens for cancel-save once', () => {
    mount();
    expect(bridge.activeListeners('cancel-save')).toBe(1);
  });

  it('goes to the opening screen when the main process cancels a save', () => {
    mount();
    bridge.emit('cancel-save');
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull();
  });

  it('goes to the replay, saving first, on toggle-edit-mode', () => {
    mount({ initialText: '<p>zq</p>' });
    bridge.clear();
    bridge.emit('toggle-edit-mode');
    expect(bridge.index('send', 'save-file')).toBeGreaterThan(
      bridge.index('store.set', 'history')
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/replay');
  });
});

describe('Editor: recording an edit', () => {
  it('appends the change to the history, updates the text context and marks the document edited', () => {
    mount({ initialText: '<p>zq</p>', initialHistory: [change(1)] });
    bridge.clear();
    typeText('xv');

    expect(setTextSpy).toHaveBeenLastCalledWith('<p>zqxv</p>');
    const newHistory = setPoemHistorySpy.mock.calls.at(-1)[0] as ChangeObj[];
    expect(newHistory).toHaveLength(2);
    expect(newHistory[0]).toEqual(change(1));
    expect(newHistory[1]).toMatchObject({ inserted: 'xv', front: 5, end: 4 });
    expect(newHistory[1].t).toBeInstanceOf(Date);
    expect(typeof newHistory[1].pos).toBe('number');
    expect(bridge.sets('edited')).toEqual([
      { kind: 'store.set', args: ['edited', 'true'] },
    ]);
  });

  it('records each of several edits, and marks edited only once', () => {
    mount({ initialText: '<p>zq</p>' });
    bridge.clear();
    typeText('a');
    typeText('b');
    typeText('c');
    const last = setPoemHistorySpy.mock.calls.at(-1)[0] as ChangeObj[];
    expect(last.map((c) => c.inserted)).toEqual(['a', 'b', 'c']);
    expect(bridge.sets('edited')).toHaveLength(1);
  });

  it('after an autosave, the next keystroke marks the document edited again', () => {
    mount({ initialText: '<p>zq</p>' });
    bridge.clear();
    typeText('a');
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(bridge.sends('save-file')).toHaveLength(1);
    typeText('b');
    expect(bridge.sets('edited')).toHaveLength(2);
  });

  it('records nothing when the content did not change', () => {
    mount({ initialText: '<p>zq</p>' });
    bridge.clear();
    act(() => {
      // An update event whose text is the same as the recorded one.
      proseMirror().editor.commands.setContent('<p>zq</p>', true);
    });
    expect(setPoemHistorySpy).not.toHaveBeenCalled();
    expect(bridge.sets('edited')).toHaveLength(0);
  });

  it('does not store or save at the moment of the edit; that waits for the pause', () => {
    mount();
    bridge.clear();
    typeText('xv');
    expect(bridge.sends('save-file')).toHaveLength(0);
    expect(bridge.sets('poem')).toHaveLength(0);
  });
});

describe('Editor: autosave', () => {
  it('typing does not re-register the toggle-edit-mode listener (the autosave timer is not state)', () => {
    mount({ initialText: '<p>zq</p>' });
    bridge.removed.splice(0);
    typeText('a');
    typeText('b');
    typeText('c');
    expect(bridge.removed).not.toContain('toggle-edit-mode');
  });

  it('when the menu asks (#157), stores the poem typed this second at once, then answers with the request’s id', () => {
    mount({ initialText: '<p>zq</p>' });
    typeText('xv');
    bridge.clear();
    bridge.emit('flush-editor', 7);
    expect(bridge.values.poem).toContain('xv');
    const poem = bridge.index('store.set', 'poem');
    const history = bridge.index('store.set', 'history');
    const answer = bridge.index('send', 'editor-flushed');
    expect(bridge.sends('editor-flushed')).toEqual([
      { kind: 'send', args: ['editor-flushed', [7]] },
    ]);
    expect(answer).toBeGreaterThan(poem);
    expect(answer).toBeGreaterThan(history);
    // The menu action does its own save; this one does not, and the pending autosave still runs.
    expect(bridge.sends('save-file')).toHaveLength(0);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(bridge.sends('save-file')).toHaveLength(1);
  });

  it('when asked after typing that no store write has carried, marks the document unsaved first (#113)', () => {
    mount({ initialText: '<p>zq</p>' });
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    // As File > Save leaves it: saved, while the editor still counts itself edited.
    bridge.values.edited = 'false';
    typeText('xv');
    bridge.clear();
    bridge.emit('flush-editor', 3);
    expect(bridge.values.edited).toBe('true');
    expect(bridge.index('store.set', 'edited')).toBeLessThan(
      bridge.index('send', 'editor-flushed')
    );
  });

  it('when asked with no typing since the last store write, leaves the saved state alone (#113)', () => {
    mount({ initialText: '<p>zq</p>' });
    typeText('xv');
    bridge.emit('flush-editor', 1);
    bridge.values.edited = 'false';
    bridge.clear();
    bridge.emit('flush-editor', 2);
    expect(bridge.sets('edited')).toHaveLength(0);
    typeText('qj');
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    bridge.values.edited = 'false';
    bridge.clear();
    bridge.emit('flush-editor', 3);
    expect(bridge.sets('edited')).toHaveLength(0);
  });

  it('stores poem and history, then sends save-file, one second after the last edit', () => {
    mount({ initialText: '<p>zq</p>' });
    bridge.clear();
    typeText('xv');

    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(bridge.sends('save-file')).toHaveLength(0);
    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(bridge.sends('save-file')).toHaveLength(1);
    const poem = bridge.index('store.set', 'poem');
    const history = bridge.index('store.set', 'history');
    const save = bridge.index('send', 'save-file');
    expect(poem).toBeGreaterThanOrEqual(0);
    expect(history).toBeGreaterThanOrEqual(0);
    expect(save).toBeGreaterThan(poem);
    expect(save).toBeGreaterThan(history);
    expect(bridge.values.poem).toBe('<p>zqxv</p>');
    const stored = JSON.parse(bridge.values.history as string);
    expect(stored).toHaveLength(1);
    expect(stored[0].inserted).toBe('xv');
  });

  it('saves the text as it stands after the last keystroke, with one save for a burst of edits', () => {
    mount({ initialText: '<p>zq</p>' });
    bridge.clear();
    typeText('a');
    act(() => {
      jest.advanceTimersByTime(600);
    });
    typeText('b');
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(bridge.sends('save-file')).toHaveLength(0);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(bridge.sends('save-file')).toHaveLength(1);
    expect(bridge.values.poem).toBe('<p>zqab</p>');
    expect(JSON.parse(bridge.values.history as string)).toHaveLength(2);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(bridge.sends('save-file')).toHaveLength(1);
  });

  it('abandons a pending autosave, with a warning, when another document is opened first', () => {
    mount({ initialText: '<p>zq</p>' });
    typeText('xv');
    bridge.emit('open-file', '<p>other</p>', [change(7)], 'other.midst');
    bridge.clear();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(bridge.sends('save-file')).toHaveLength(0);
    expect(bridge.calls.filter((c) => c.kind === 'log.warn')).toHaveLength(1);
  });

  it('leaves no autosave pending after unmount', () => {
    const { unmount } = mount();
    typeText('xv');
    unmount();
    bridge.clear();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(bridge.sends('save-file')).toHaveLength(0);
  });
});

describe('Editor: opening another document', () => {
  it('shows it, titles the window, stores the opened document (not the old one) and stays on the editor', () => {
    mount({ initialText: '<p>zq</p>' });
    bridge.clear();
    const opened = [change(3)];
    bridge.emit('open-file', '<p>other poem</p>', opened, 'other.midst');

    expect(setTextSpy).toHaveBeenLastCalledWith('<p>other poem</p>');
    expect(setPoemHistorySpy).toHaveBeenLastCalledWith(opened);
    expect(bridge.calls).toContainEqual({
      kind: 'title',
      args: ['other.midst'],
    });
    expect(proseMirror()).toHaveTextContent('other poem');
    expect(bridge.values.poem).toBe('<p>other poem</p>');
    expect(bridge.values.history).toBe(JSON.stringify(opened));
    expect(bridge.index('send', 'save-file')).toBeGreaterThan(
      bridge.index('store.set', 'history')
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/editor');
  });

  it('records the next edit against the opened document', () => {
    mount({ initialText: '<p>zq</p>' });
    bridge.emit('open-file', '<p>other</p>', [change(3)], 'other.midst');
    typeText('!');
    const history = setPoemHistorySpy.mock.calls.at(-1)[0] as ChangeObj[];
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(change(3));
    expect(setTextSpy).toHaveBeenLastCalledWith('<p>other!</p>');
  });
});

describe('Editor: spellcheck toggle', () => {
  const stubReload = () => {
    // jsdom cannot navigate; it reports the attempt to the console.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    return spy;
  };

  it('stores the flipped setting, saves, remembers to return to the editor, and reloads', () => {
    const errors = stubReload();
    mount({ initialText: '<p>zq</p>' });
    bridge.clear();
    bridge.emit('toggle-spellcheck');

    expect(bridge.values.spellcheck).toBe('true');
    expect(bridge.values.poem).toBe('<p>zq</p>');
    expect(bridge.sends('save-file')).toHaveLength(1);
    expect(bridge.index('send', 'save-file')).toBeGreaterThan(
      bridge.index('store.set', 'poem')
    );
    expect(window.sessionStorage.getItem(RETURN_TO)).toBe('/editor');
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('navigation'),
      })
    );
    errors.mockRestore();
  });

  it('does not re-register the open-file listener', () => {
    const errors = stubReload();
    mount();
    bridge.removed.splice(0);
    bridge.emit('toggle-spellcheck');
    expect(bridge.removed).not.toContain('open-file');
    errors.mockRestore();
  });

  it('turns an enabled setting off', () => {
    const errors = stubReload();
    bridge = installBridge({ spellcheck: 'true' });
    mount();
    bridge.emit('toggle-spellcheck');
    expect(bridge.values.spellcheck).toBe('false');
    errors.mockRestore();
  });

  it('keeps the keystrokes of the last second by saving before the reload', () => {
    const errors = stubReload();
    mount({ initialText: '<p>zq</p>' });
    typeText('xv');
    bridge.clear();
    bridge.emit('toggle-spellcheck');
    expect(bridge.values.poem).toBe('<p>zqxv</p>');
    expect(bridge.sends('save-file')).toHaveLength(1);
    errors.mockRestore();
  });
});

describe('Editor: Replay button', () => {
  it('saves the pending text and history, then goes to the replay', () => {
    mount({ initialText: '<p>zq</p>' });
    typeText('xv');
    bridge.clear();
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));

    expect(bridge.values.poem).toBe('<p>zqxv</p>');
    expect(JSON.parse(bridge.values.history as string)).toHaveLength(1);
    expect(bridge.sends('save-file')).toHaveLength(1);
    expect(bridge.index('send', 'save-file')).toBeGreaterThan(
      bridge.index('store.set', 'poem')
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/replay');
  });

  it('does not save a second time from the cancelled autosave after leaving', () => {
    mount({ initialText: '<p>zq</p>' });
    typeText('xv');
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    bridge.clear();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(bridge.sends('save-file')).toHaveLength(0);
  });
});

describe('Editor: draft marker button', () => {
  it('is disabled while the history is short', () => {
    mount({ initialHistory: [change(1)] });
    expect(
      screen.getByRole('button', { name: 'Mark this moment as a draft' })
    ).toBeDisabled();
  });

  it('is enabled once the history is long enough', () => {
    mount({ initialHistory: LONG_HISTORY });
    expect(
      screen.getByRole('button', { name: 'Mark this moment as a draft' })
    ).toBeEnabled();
  });

  it('stores the marker at the latest moment, saves, and goes to the replay to name it', () => {
    mount({ initialText: '<p>zq</p>', initialHistory: LONG_HISTORY });
    bridge.clear();
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark this moment as a draft' })
    );

    const meta = JSON.parse(bridge.values.meta as string);
    expect(meta.draftMarkers).toEqual([{ index: 59, defaultName: 'Draft 1' }]);
    expect(bridge.values.edited).toBe('true');
    expect(bridge.sends('save-file').length).toBeGreaterThanOrEqual(1);
    expect(bridge.index('store.set', 'meta')).toBeLessThan(
      bridge.index('send', 'save-file')
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/replay');
    expect(screen.getByTestId('where')).toHaveTextContent('{"nameDraftAt":59}');
  });

  it('cancels the pending autosave, because marking saves the document itself', () => {
    mount({ initialText: '<p>zq</p>', initialHistory: LONG_HISTORY });
    typeText('xv');
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark this moment as a draft' })
    );
    bridge.clear();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(bridge.sends('save-file')).toHaveLength(0);
  });

  it('is disabled for a moment that already has a marker', () => {
    bridge = installBridge({
      meta: JSON.stringify({
        draftMarkers: [{ index: 59, defaultName: 'Draft 1' }],
      }),
    });
    mount({ initialHistory: LONG_HISTORY });
    expect(
      screen.getByRole('button', { name: 'Mark this moment as a draft' })
    ).toBeDisabled();
  });

  it('says why it is disabled while the history is short, and looks unavailable (GitHub #66)', () => {
    mount({ initialHistory: [change(1)] });
    const button = screen.getByRole('button', {
      name: 'Mark this moment as a draft',
    });
    expect(button).toHaveAccessibleDescription(
      'A draft can be marked once the poem has more than 50 changes. This one has 1.'
    );
    expect(button).toHaveStyle({ opacity: '0.38' });
  });

  it('says a moment already has a draft when that is why it is disabled', () => {
    bridge = installBridge({
      meta: JSON.stringify({
        draftMarkers: [{ index: 59, defaultName: 'Draft 1' }],
      }),
    });
    mount({ initialHistory: LONG_HISTORY });
    expect(
      screen.getByRole('button', { name: 'Mark this moment as a draft' })
    ).toHaveAccessibleDescription('This moment already has a draft.');
  });

  it('has no reason and looks available when a draft can be marked', () => {
    mount({ initialHistory: LONG_HISTORY });
    const button = screen.getByRole('button', {
      name: 'Mark this moment as a draft',
    });
    expect(button).toHaveAccessibleDescription('');
    expect(button).not.toHaveStyle({ opacity: '0.38' });
  });

  it('stays on the editor when the stored meta cannot be read', () => {
    bridge = installBridge({ meta: 'not json' });
    mount({ initialHistory: LONG_HISTORY });
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark this moment as a draft' })
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/editor');
    expect(bridge.values.meta).toBe('not json');
    expect(bridge.calls.filter((c) => c.kind === 'log.error')).toEqual([
      {
        kind: 'log.error',
        args: [
          REFUSED_LOG,
          {
            reason: 'meta-unreadable',
            action: 'create',
            index: 59,
            historyLength: 60,
          },
        ],
      },
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The drafts of this poem could not be read, so nothing was changed.'
    );
  });
});

describe('Editor: Tab key', () => {
  it('inserts a tab character into the poem', () => {
    mount({ initialText: '<p>zq</p>' });
    typeText('\t');
    expect(setTextSpy).toHaveBeenLastCalledWith(expect.stringContaining('\t'));
  });
});

// GitHub #24: leaving the editor (for Replay) and coming back makes a new editor. The cursor goes back where it
// was, but only into the same text: a different poem, or a changed one, starts as before.
describe('Editor: the cursor when coming back', () => {
  const TEXT = '<p>zq xv qz vb</p>';
  const selectionNow = () => {
    const { from, to, anchor, head } = proseMirror().editor.state.selection;
    return { from, to, anchor, head };
  };
  const leaveWithSelection = (anchor: number, head: number) => {
    const { unmount } = mount({ initialText: TEXT });
    act(() => {
      proseMirror().editor.commands.setTextSelection({
        from: anchor,
        to: head,
      });
    });
    unmount();
  };

  it('puts the cursor back where it was', () => {
    leaveWithSelection(6, 6);
    mount({ initialText: TEXT });
    settleFocus();
    expect(selectionNow()).toEqual({ from: 6, to: 6, anchor: 6, head: 6 });
  });

  it('puts a selection back as it was', () => {
    leaveWithSelection(4, 9);
    mount({ initialText: TEXT });
    settleFocus();
    expect(selectionNow()).toEqual({ from: 4, to: 9, anchor: 4, head: 9 });
  });

  it('starts as before when the text is not the text it left', () => {
    leaveWithSelection(6, 6);
    mount({ initialText: '<p>qz</p>' });
    settleFocus();
    expect(selectionNow()).toEqual({ from: 1, to: 1, anchor: 1, head: 1 });
  });
});
