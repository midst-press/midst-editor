import { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { undoDepth } from '@tiptap/pm/history';
import poemExtensions from '@midst-press/midst-format/extensions';
import checkWholePoem, {
  AGAIN_MS,
  checkWholePoemSoon,
  FIRST_MS,
  MISMATCH_LOG,
  PAUSE_MS,
} from '../renderer/spellcheck/checkWholePoem';

// src/renderer/spellcheck/checkWholePoem.ts (issue #238): an edit Chromium counts, that ProseMirror never sees
// and the DOM does not keep. jsdom has no editing commands, so execCommand is a stand-in that does what
// Chromium's insertText and delete do at a collapsed selection in a text node. Invented letters only.

let calls: string[];
let dom: HTMLElement;
let observer: { stop: jest.Mock; start: jest.Mock };
// A stand-in view: the DOM, the observer, whether a composition is under way, and the poem (only its identity).
let fake: { composing: boolean; state: { doc: object } };

const view = () =>
  ({ dom, domObserver: observer, ...fake } as unknown as EditorView);

beforeEach(() => {
  jest.useFakeTimers();
  calls = [];
  fake = { composing: false, state: { doc: {} } };
  dom = document.createElement('div');
  dom.innerHTML = '<p>Zq wrd</p><p>xq</p>';
  document.body.appendChild(dom);
  observer = {
    stop: jest.fn(() => calls.push('stop')),
    start: jest.fn(() => calls.push('start')),
  };
  document.execCommand = jest.fn(
    (command: string, _ui?: boolean, value?: string) => {
      calls.push(
        value === undefined ? command : `${command} ${JSON.stringify(value)}`
      );
      const sel = document.getSelection()!;
      const node = sel.anchorNode as Text;
      const at = sel.anchorOffset;
      if (command === 'insertText') {
        node.insertData(at, value!);
        sel.collapse(node, at + value!.length);
      } else if (command === 'delete') {
        node.deleteData(at - 1, 1);
        sel.collapse(node, at - 1);
      }
      return true;
    }
  );
});
afterEach(() => {
  jest.useRealTimers();
  dom.remove();
});

const selectIn = (node: Node, offset: number) =>
  document.getSelection()!.collapse(node, offset);

describe('checkWholePoem', () => {
  it('types a space at the end of the first text with the observer stopped, and deletes it after the pause', () => {
    const first = dom.querySelector('p')!.firstChild as Text;
    const before = dom.innerHTML;
    const log = jest.fn();
    checkWholePoem(view(), log);
    expect(calls).toEqual(['stop', 'insertText " "']);
    expect(first.data).toBe('Zq wrd ');

    jest.advanceTimersByTime(PAUSE_MS - 1);
    expect(calls).toEqual(['stop', 'insertText " "']);
    jest.advanceTimersByTime(1);
    expect(calls).toEqual(['stop', 'insertText " "', 'delete', 'start']);
    expect(dom.innerHTML).toBe(before);
    expect(log).not.toHaveBeenCalled();
  });

  it("puts the poet's selection back", () => {
    const second = dom.querySelectorAll('p')[1].firstChild as Text;
    selectIn(second, 1);
    checkWholePoem(view(), jest.fn());
    jest.advanceTimersByTime(PAUSE_MS);
    const sel = document.getSelection()!;
    expect([sel.anchorNode, sel.anchorOffset]).toEqual([second, 1]);
  });

  it('passes over text nodes with no text', () => {
    dom.innerHTML = '<p></p><p>Zq</p>';
    dom.querySelector('p')!.appendChild(document.createTextNode(''));
    checkWholePoem(view(), jest.fn());
    expect((dom.querySelectorAll('p')[1].firstChild as Text).data).toBe('Zq ');
    jest.advanceTimersByTime(PAUSE_MS);
  });

  it('does nothing to an editor with no text', () => {
    dom.innerHTML = '<p><br></p>';
    const cancel = checkWholePoem(view(), jest.fn());
    jest.advanceTimersByTime(PAUSE_MS);
    cancel();
    expect(calls).toEqual([]);
  });

  it('finishes at once when cancelled first, and only once', () => {
    const before = dom.innerHTML;
    const cancel = checkWholePoem(view(), jest.fn());
    cancel();
    expect(calls).toEqual(['stop', 'insertText " "', 'delete', 'start']);
    expect(dom.innerHTML).toBe(before);
    jest.advanceTimersByTime(PAUSE_MS);
    cancel();
    expect(calls).toHaveLength(4);
  });

  it('a cancel after it has finished does nothing', () => {
    const cancel = checkWholePoem(view(), jest.fn());
    jest.advanceTimersByTime(PAUSE_MS);
    cancel();
    expect(calls).toHaveLength(4);
  });

  it('does nothing while a composition is under way', () => {
    fake.composing = true;
    checkWholePoem(view(), jest.fn());
    jest.advanceTimersByTime(PAUSE_MS);
    expect(calls).toEqual([]);
  });

  it.each(['keydown', 'beforeinput', 'compositionstart', 'mousedown'])(
    "a %s in the editor finishes it before the poet's input lands",
    (type) => {
      const before = dom.innerHTML;
      checkWholePoem(view(), jest.fn());
      dom.dispatchEvent(new Event(type, { bubbles: true }));
      expect(calls).toEqual(['stop', 'insertText " "', 'delete', 'start']);
      expect(dom.innerHTML).toBe(before);
      jest.advanceTimersByTime(PAUSE_MS);
      expect(calls).toHaveLength(4);
    }
  );

  it('stops listening once it has finished', () => {
    checkWholePoem(view(), jest.fn());
    jest.advanceTimersByTime(PAUSE_MS);
    dom.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(calls).toHaveLength(4);
  });
});

describe('checkWholePoemSoon', () => {
  it('checks at FIRST_MS and again at AGAIN_MS, and not before', () => {
    checkWholePoemSoon(view(), jest.fn());
    jest.advanceTimersByTime(FIRST_MS - 1);
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(1 + PAUSE_MS);
    expect(calls).toEqual(['stop', 'insertText " "', 'delete', 'start']);
    jest.advanceTimersByTime(AGAIN_MS - FIRST_MS - PAUSE_MS - 1);
    expect(calls).toHaveLength(4);
    jest.advanceTimersByTime(1 + PAUSE_MS);
    expect(calls).toHaveLength(8);
  });

  it('cancelled before it starts, it never touches the editor', () => {
    const cancel = checkWholePoemSoon(view(), jest.fn());
    cancel();
    jest.advanceTimersByTime(AGAIN_MS + PAUSE_MS);
    expect(calls).toEqual([]);
  });

  it('cancelled during a check, it finishes that one and starts no other', () => {
    const before = dom.innerHTML;
    const cancel = checkWholePoemSoon(view(), jest.fn());
    jest.advanceTimersByTime(FIRST_MS);
    expect(calls).toEqual(['stop', 'insertText " "']);
    cancel();
    expect(calls).toEqual(['stop', 'insertText " "', 'delete', 'start']);
    expect(dom.innerHTML).toBe(before);
    jest.advanceTimersByTime(AGAIN_MS + PAUSE_MS);
    expect(calls).toHaveLength(4);
  });

  it('starts no check once the poem has changed', () => {
    checkWholePoemSoon(view(), jest.fn());
    jest.advanceTimersByTime(FIRST_MS + PAUSE_MS);
    expect(calls).toHaveLength(4);
    fake.state.doc = {};
    jest.advanceTimersByTime(AGAIN_MS);
    expect(calls).toHaveLength(4);
  });
});

// With a real editor: what happens when the DOM is not as the insert left it (Silas, review of #250).
describe('checkWholePoem in a real editor', () => {
  let editor: Editor;
  const transactions = () => {
    const seen: { docChanged: boolean }[] = [];
    editor.on('transaction', ({ transaction }) => seen.push(transaction));
    return seen;
  };
  // The DOM is ProseMirror's when it reads back as the state's text, paragraph by paragraph.
  const paragraphs = () =>
    Array.from(editor.view.dom.querySelectorAll('p')).map((p) => p.textContent);
  const stateParagraphs = () => {
    const out: string[] = [];
    editor.state.doc.forEach((node) => out.push(node.textContent));
    return out;
  };

  beforeEach(() => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: poemExtensions,
      content: '<p>Zq wrd</p><p>xq</p>',
    });
  });
  afterEach(() => editor.destroy());

  it('deletes the space when nothing else happened, and nothing changes the poem or its history', () => {
    const seen = transactions();
    const depth = undoDepth(editor.state);
    const log = jest.fn();
    checkWholePoem(editor.view, log);
    expect(paragraphs()).toEqual(['Zq wrd ', 'xq']);
    jest.advanceTimersByTime(PAUSE_MS);
    expect(paragraphs()).toEqual(['Zq wrd', 'xq']);
    // Putting the selection back is read as a selection, which changes no document.
    expect(seen.filter((t) => t.docChanged)).toEqual([]);
    expect(undoDepth(editor.state)).toBe(depth);
    expect(log).not.toHaveBeenCalled();
  });

  it('when a transaction renders meanwhile, deletes nothing, redraws from the state and logs', () => {
    const log = jest.fn();
    const depth = undoDepth(editor.state);
    checkWholePoem(editor.view, log);
    editor.commands.setContent('<p>Zq other</p><p>xq</p>');
    const changed = undoDepth(editor.state);
    jest.advanceTimersByTime(PAUSE_MS);
    expect(calls).not.toContain('delete');
    expect(paragraphs()).toEqual(stateParagraphs());
    expect(paragraphs()).toEqual(['Zq other', 'xq']);
    expect(log).toHaveBeenCalledWith(MISMATCH_LOG);
    // The redraw is not in the history: only the setContent is.
    expect(undoDepth(editor.state)).toBe(changed);
    expect(changed).toBeGreaterThanOrEqual(depth);
  });

  it('when something else has focus, deletes nothing there, and takes the space out by redrawing', () => {
    const field = document.createElement('input');
    field.value = 'zq';
    document.body.appendChild(field);
    const log = jest.fn();
    checkWholePoem(editor.view, log);
    field.focus();
    jest.advanceTimersByTime(PAUSE_MS);
    expect(calls).not.toContain('delete');
    expect(field.value).toBe('zq');
    expect(paragraphs()).toEqual(['Zq wrd', 'xq']);
    expect(log).toHaveBeenCalledWith(MISMATCH_LOG);
    field.remove();
  });
});
