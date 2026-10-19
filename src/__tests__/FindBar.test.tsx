import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import type { ElectronHandler } from 'main/preload';
import poemExtensions from '@midst-press/midst-format/extensions';
import FindBar, {
  noMatches,
  notReady,
  searchFailed,
  SEARCH_FAILED_LOG,
  CLEAR_FAILED_LOG,
  typeFirst,
} from '../renderer/search/FindBar';
import findInText from '../renderer/search/findInText';
import SearchHighlight, {
  CURRENT_CLASS,
  searchHighlightKey,
  withHighlights,
} from '../renderer/search/searchHighlight';

// Synthetic text only.

// The real search, which a test can make throw once.
jest.mock('../renderer/search/findInText', () => {
  const actual = jest.requireActual('../renderer/search/findInText');
  return { __esModule: true, ...actual, default: jest.fn(actual.default) };
});

type Listener = Parameters<ElectronHandler['ipcRenderer']['on']>[1];

const installBridge = () => {
  const listeners: Record<string, Listener[]> = {};
  const errors: { message: string; meta: unknown }[] = [];
  (window as unknown as { electron: unknown }).electron = {
    versions: { isMac: false },
    ipcRenderer: {
      on: (channel: string, listener: Listener) => {
        listeners[channel] = [...(listeners[channel] ?? []), listener];
        return () => {
          listeners[channel] = listeners[channel].filter((l) => l !== listener);
        };
      },
    },
    log: {
      error: (message: string, meta: unknown) => errors.push({ message, meta }),
    },
  };
  return {
    errors,
    listening: () => (listeners['find-in-poem'] ?? []).length,
    openBar: () =>
      act(() => {
        (listeners['find-in-poem'] ?? []).forEach((l) => l());
      }),
  };
};

const editors: Editor[] = [];
const makeEditor = (html: string) => {
  const editor = new Editor({
    extensions: [...poemExtensions, SearchHighlight],
    content: html,
    parseOptions: { preserveWhitespace: true },
  });
  editors.push(editor);
  return editor;
};

const field = () => screen.getByRole('textbox', { name: 'Find in the poem' });
const status = () => screen.getByRole('status');
const type = (text: string) =>
  act(() => {
    fireEvent.change(field(), { target: { value: text } });
  });
const key = (name: string, shiftKey = false) =>
  act(() => {
    fireEvent.keyDown(field(), { key: name, shiftKey });
  });
const highlights = (editor: Editor) =>
  searchHighlightKey.getState(editor.state)!.find();
const currentHighlights = (editor: Editor) =>
  highlights(editor).filter((d) =>
    String(
      (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class
    ).includes(CURRENT_CLASS)
  );
const selected = (editor: Editor) => {
  const { from, to } = editor.state.selection;
  return { from, to, text: editor.state.doc.textBetween(from, to) };
};

// Counts the changes the editor would record in the poem's history: Editor's onUpdate runs on these.
const countUpdates = (editor: Editor) => {
  const seen = { n: 0 };
  editor.on('update', () => {
    seen.n += 1;
  });
  return seen;
};

beforeAll(() => {
  // jsdom has no layout; ProseMirror asks for these when it scrolls a selection into view.
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
  const none = () =>
    ({
      item: () => null,
      length: 0,
      [Symbol.iterator]: [][Symbol.iterator],
    } as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = none;
  Element.prototype.getClientRects = none;
});

let bridge: ReturnType<typeof installBridge>;
beforeEach(() => {
  bridge = installBridge();
});
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

const TWO = '<p>zq qv</p><p>qv</p>'; // 'qv' at 4-6 and 8-10

describe('FindBar: opening', () => {
  it('FB-O-1 is hidden until Edit > Find, then shows the field focused', () => {
    render(<FindBar editor={makeEditor(TWO)} />);
    expect(screen.queryByRole('search')).toBeNull();
    bridge.openBar();
    expect(field()).toHaveFocus();
    expect(status()).toBeEmptyDOMElement();
  });

  it('FB-O-2 stops listening for Edit > Find when it goes away', () => {
    const { unmount } = render(<FindBar editor={makeEditor(TWO)} />);
    expect(bridge.listening()).toBe(1);
    unmount();
    expect(bridge.listening()).toBe(0);
  });

  it('FB-O-3 opening again keeps the query and selects it, to type over', () => {
    render(<FindBar editor={makeEditor(TWO)} />);
    bridge.openBar();
    type('qv');
    bridge.openBar();
    const input = field() as HTMLInputElement;
    expect(input.value).toBe('qv');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);
  });
});

describe('FindBar: searching', () => {
  it('FB-Q-1 selects the first match and marks every match, the first as current', () => {
    const editor = makeEditor(TWO);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    type('QV');
    expect(status()).toHaveTextContent('1 of 2');
    expect(selected(editor)).toEqual({ from: 4, to: 6, text: 'qv' });
    expect(highlights(editor).map((d) => [d.from, d.to])).toEqual([
      [4, 6],
      [8, 10],
    ]);
    expect(currentHighlights(editor).map((d) => d.from)).toEqual([4]);
  });

  it('FB-Q-2 says "No matches", disables the arrows, marks nothing and moves nothing', () => {
    const editor = makeEditor(TWO);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    const before = selected(editor);
    type('zz');
    expect(status()).toHaveTextContent(noMatches());
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Previous match' })
    ).toBeDisabled();
    expect(highlights(editor)).toHaveLength(0);
    expect(selected(editor)).toEqual(before);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('FB-Q-3 an emptied field says nothing and marks nothing', () => {
    const editor = makeEditor(TWO);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    type('qv');
    type('');
    expect(status()).toBeEmptyDOMElement();
    expect(highlights(editor)).toHaveLength(0);
  });

  it('FB-Q-4 a match that spans bold is selected whole', () => {
    const editor = makeEditor('<p>z<strong>q</strong>v</p>');
    render(<FindBar editor={editor} />);
    bridge.openBar();
    type('zqv');
    expect(status()).toHaveTextContent('1 of 1');
    expect(selected(editor).text).toBe('zqv');
  });
});

describe('FindBar: moving between matches', () => {
  const setUp = () => {
    const editor = makeEditor(TWO);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    type('qv');
    return editor;
  };

  it('FB-N-1 Enter goes forward and wraps from the last to the first', () => {
    const editor = setUp();
    key('Enter');
    expect(status()).toHaveTextContent('2 of 2');
    expect(selected(editor)).toEqual({ from: 8, to: 10, text: 'qv' });
    expect(currentHighlights(editor).map((d) => d.from)).toEqual([8]);
    key('Enter');
    expect(status()).toHaveTextContent('1 of 2');
    expect(selected(editor).from).toBe(4);
  });

  it('FB-N-2 Shift+Enter goes back and wraps from the first to the last', () => {
    const editor = setUp();
    key('Enter', true);
    expect(status()).toHaveTextContent('2 of 2');
    expect(selected(editor).from).toBe(8);
  });

  it('FB-N-3 the arrow buttons do the same as Enter and Shift+Enter', () => {
    const editor = setUp();
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(selected(editor).from).toBe(8);
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(selected(editor).from).toBe(4);
  });

  it('FB-N-4 Enter with no matches does nothing', () => {
    const editor = makeEditor(TWO);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    type('zz');
    const before = selected(editor);
    key('Enter');
    expect(status()).toHaveTextContent(noMatches());
    expect(selected(editor)).toEqual(before);
  });
});

describe('FindBar: the poem and its history', () => {
  it('FB-H-1 searching, moving and closing record no change and leave the text as it was', () => {
    const editor = makeEditor(TWO);
    const html = editor.getHTML();
    const updates = countUpdates(editor);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    type('qv');
    key('Enter');
    key('Enter', true);
    key('Escape');
    expect(updates.n).toBe(0);
    expect(editor.getHTML()).toBe(html);
  });

  it('FB-E-1 when the poet edits with the bar open, the matches follow and the cursor is not moved', () => {
    const editor = makeEditor(TWO);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    type('qv');
    key('Enter'); // on the second match
    act(() => {
      editor.chain().setTextSelection(1).insertContent('qv ').run();
    });
    expect(highlights(editor).map((d) => [d.from, d.to])).toEqual([
      [1, 3],
      [7, 9],
      [11, 13],
    ]);
    expect(status()).toHaveTextContent('2 of 3');
    // The cursor stays after the typed text, not on a match.
    expect(selected(editor)).toEqual({ from: 4, to: 4, text: '' });
  });

  it('FB-E-2 an edit that removes every match says "No matches"', () => {
    const editor = makeEditor('<p>qv</p>');
    render(<FindBar editor={editor} />);
    bridge.openBar();
    type('qv');
    act(() => {
      editor.commands.setContent('<p>zz</p>', true);
    });
    expect(status()).toHaveTextContent(noMatches());
    expect(highlights(editor)).toHaveLength(0);
  });

  it('FB-E-3 edits after closing no longer search', () => {
    const editor = makeEditor(TWO);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    type('qv');
    key('Escape');
    act(() => {
      editor.chain().setTextSelection(1).insertContent('qv ').run();
    });
    expect(highlights(editor)).toHaveLength(0);
  });
});

describe('FindBar: closing', () => {
  it.each([
    ['Escape', () => key('Escape')],
    [
      'the close button',
      () => fireEvent.click(screen.getByRole('button', { name: 'Close find' })),
    ],
  ])(
    'FB-C-1 %s closes, clears the marks and puts the cursor just after the last match',
    (_, closeIt) => {
      const editor = makeEditor(TWO);
      render(<FindBar editor={editor} />);
      bridge.openBar();
      type('qv');
      key('Enter');
      act(() => {
        closeIt();
      });
      expect(screen.queryByRole('search')).toBeNull();
      expect(highlights(editor)).toHaveLength(0);
      // Collapsed, so the next keystroke does not replace the match.
      expect(selected(editor)).toEqual({ from: 10, to: 10, text: '' });
    }
  );
});

describe('FindBar: closing with nothing found', () => {
  it('FB-C-2 leaves the cursor where it was', () => {
    const editor = makeEditor(TWO);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    const before = selected(editor);
    type('zz');
    key('Escape');
    expect(selected(editor)).toEqual(before);
  });
});

describe('FindBar: why the arrows are unavailable', () => {
  it('FB-A-1 before anything is typed they say to type first; after, the status says why', () => {
    render(<FindBar editor={makeEditor(TWO)} />);
    bridge.openBar();
    const next = screen.getByRole('button', { name: 'Next match' });
    expect(next).toBeDisabled();
    expect(next).toHaveAccessibleDescription(typeFirst());
    type('zz');
    expect(next).toHaveAccessibleDescription(noMatches());
    expect(
      screen.getByRole('button', { name: 'Previous match' })
    ).toHaveAccessibleDescription(noMatches());
  });
});

describe('FindBar: when it cannot search', () => {
  it('FB-R-1 before the editor exists it says why, and only once the poet types', () => {
    render(<FindBar editor={null} />);
    bridge.openBar();
    expect(screen.queryByRole('alert')).toBeNull();
    type('qv');
    expect(screen.getByRole('alert')).toHaveTextContent(notReady());
    expect(status()).toBeEmptyDOMElement();
    type('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(bridge.errors).toEqual([]);
  });

  it('FB-X-1 a search that throws is logged without the poem, and the poet is told', () => {
    const broken = {
      get state(): never {
        throw new TypeError('zq qv');
      },
      isDestroyed: false,
      on: () => undefined,
      off: () => undefined,
    } as unknown as Editor;
    render(<FindBar editor={broken} />);
    bridge.openBar();
    type('qv');
    expect(screen.getByRole('alert')).toHaveTextContent(searchFailed());
    expect(bridge.errors).toEqual([
      { message: SEARCH_FAILED_LOG, meta: { error: 'TypeError' } },
      // The broken editor cannot be cleared either: that is logged too, not thrown.
      { message: CLEAR_FAILED_LOG, meta: { error: 'TypeError' } },
    ]);
    expect(JSON.stringify(bridge.errors)).not.toContain('zq');
    expect(status()).toBeEmptyDOMElement();
  });

  it('FB-X-2 a non-Error thrown is logged by its type', () => {
    const broken = {
      get state(): never {
        const thrown: unknown = 'zq';
        throw thrown;
      },
      isDestroyed: false,
      on: () => undefined,
      off: () => undefined,
    } as unknown as Editor;
    render(<FindBar editor={broken} />);
    bridge.openBar();
    type('qv');
    expect(bridge.errors).toEqual([
      { message: SEARCH_FAILED_LOG, meta: { error: 'string' } },
      // The broken editor cannot be cleared either: that is logged too, not thrown.
      { message: CLEAR_FAILED_LOG, meta: { error: 'string' } },
    ]);
  });

  it('FB-X-3 a failed search clears the earlier marks, and the next search that works clears the message', () => {
    const editor = makeEditor(TWO);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    type('qv');
    expect(highlights(editor)).toHaveLength(2);
    jest.mocked(findInText).mockImplementationOnce(() => {
      throw new TypeError('x');
    });
    type('qvz');
    expect(screen.getByRole('alert')).toHaveTextContent(searchFailed());
    // Logged once, by the error's name: the clear worked, so it logs nothing (#160).
    expect(bridge.errors).toEqual([
      { message: SEARCH_FAILED_LOG, meta: { error: 'TypeError' } },
    ]);
    // No marks left over from the earlier search while the bar says it failed.
    expect(highlights(editor)).toHaveLength(0);
    type('q');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(status()).toHaveTextContent('1 of 3');
    // The search that worked logs nothing more.
    expect(bridge.errors).toHaveLength(1);
  });

  it('FB-X-4 a destroyed editor is searched but not touched', () => {
    const editor = makeEditor(TWO);
    render(<FindBar editor={editor} />);
    bridge.openBar();
    editor.destroy();
    type('qv');
    expect(status()).toHaveTextContent('1 of 2');
    expect(bridge.errors).toEqual([]);
  });
});

describe('searchHighlight on its own', () => {
  it('SH-1 the marks move with the text when it is edited', () => {
    const editor = makeEditor(TWO);
    editor.view.dispatch(
      withHighlights(editor.state.tr, {
        matches: [{ from: 8, to: 10 }],
        current: 0,
      })
    );
    editor.view.dispatch(editor.state.tr.insertText('zz', 1));
    expect(highlights(editor).map((d) => [d.from, d.to])).toEqual([[10, 12]]);
    expect(editor.state.doc.textBetween(10, 12)).toBe('qv');
  });

  it('SH-2 an empty list clears the marks', () => {
    const editor = makeEditor(TWO);
    editor.view.dispatch(
      withHighlights(editor.state.tr, {
        matches: [{ from: 4, to: 6 }],
        current: 0,
      })
    );
    editor.view.dispatch(
      withHighlights(editor.state.tr, { matches: [], current: -1 })
    );
    expect(highlights(editor)).toHaveLength(0);
  });
});
