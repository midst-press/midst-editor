import { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { undoDepth } from '@tiptap/pm/history';
import poemExtensions from '@midst-press/midst-format/extensions';
import checkWholePoem, {
  AGAIN_MS,
  BREAK_PAUSE_MS,
  checkLinesAfterBreaks,
  checkParagraphs,
  checkWholePoemSoon,
  FIRST_MS,
  MISMATCH_LOG,
  PAUSE_MS,
} from '../renderer/spellcheck/checkWholePoem';

// src/renderer/spellcheck/checkWholePoem.ts (issue #238): edits Chromium counts, one paragraph at a time, that
// ProseMirror never sees and the DOM does not keep. jsdom has no editing commands, so execCommand is a stand-in
// that does what Chromium's insertText and delete do at a collapsed selection in a text node. Invented letters
// only.

let calls: string[];
let dom: HTMLElement;
let observer: { stop: jest.Mock; start: jest.Mock };
// A stand-in view: the DOM, the observer, whether a composition is under way, and the poem (only its identity).
let fake: { composing: boolean; state: { doc: object } };

const view = () =>
  ({ dom, domObserver: observer, ...fake }) as unknown as EditorView;

// One paragraph's edit, and the whole of a check over the two paragraphs most tests use.
const ONE = ['insertText " "', 'delete'];
const BOTH = ['stop', ...ONE, ...ONE, 'start'];

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
const texts = () =>
  Array.from(dom.querySelectorAll('p')).map((p) => p.textContent);

describe('checkWholePoem', () => {
  it('types a space after each paragraph in turn with the observer stopped, each deleted after the pause', () => {
    const before = dom.innerHTML;
    const log = jest.fn();
    checkWholePoem(view(), log);
    expect(calls).toEqual(['stop', 'insertText " "']);
    expect(texts()).toEqual(['Zq wrd ', 'xq']);

    jest.advanceTimersByTime(PAUSE_MS - 1);
    expect(calls).toEqual(['stop', 'insertText " "']);
    jest.advanceTimersByTime(1);
    expect(calls).toEqual(['stop', ...ONE, 'insertText " "']);
    expect(texts()).toEqual(['Zq wrd', 'xq ']);

    jest.advanceTimersByTime(PAUSE_MS);
    expect(calls).toEqual(BOTH);
    expect(dom.innerHTML).toBe(before);
    expect(log).not.toHaveBeenCalled();
  });

  it("puts the poet's selection and scroll position back", () => {
    const second = dom.querySelectorAll('p')[1].firstChild as Text;
    selectIn(second, 1);
    dom.scrollTop = 40;
    checkWholePoem(view(), jest.fn());
    dom.scrollTop = 0;
    jest.advanceTimersByTime(2 * PAUSE_MS);
    const sel = document.getSelection()!;
    expect([sel.anchorNode, sel.anchorOffset]).toEqual([second, 1]);
    expect(dom.scrollTop).toBe(40);
  });

  it('puts the space just after the last word, before any spaces that end the line', () => {
    dom.innerHTML = '<p>zq wd  </p>';
    checkWholePoem(view(), jest.fn());
    const sel = document.getSelection()!;
    expect(sel.anchorOffset).toBe('zq wd '.length);
    jest.advanceTimersByTime(PAUSE_MS);
    expect(texts()).toEqual(['zq wd  ']);
  });

  it('uses the last text in a paragraph that has a word, and passes over paragraphs with none', () => {
    dom.innerHTML = '<p><em>zq</em> <strong>wd</strong> </p><p> </p><p></p>';
    dom.querySelectorAll('p')[2].appendChild(document.createTextNode(''));
    checkWholePoem(view(), jest.fn());
    expect(document.getSelection()!.anchorNode?.parentElement?.tagName).toBe(
      'STRONG'
    );
    jest.advanceTimersByTime(PAUSE_MS);
    expect(calls).toEqual(['stop', ...ONE, 'start']);
  });

  it('checks the paragraphs on screen first, then the others in order', () => {
    dom.innerHTML = '<p>zq</p><p>xv</p><p>wd</p>';
    const [first, second, third] = Array.from(dom.querySelectorAll('p'));
    const box = (top: number) =>
      ({ top, bottom: top + 10 }) as unknown as DOMRect;
    jest.spyOn(dom, 'getBoundingClientRect').mockReturnValue(box(0));
    jest.spyOn(first, 'getBoundingClientRect').mockReturnValue(box(-50));
    jest.spyOn(second, 'getBoundingClientRect').mockReturnValue(box(0));
    jest.spyOn(third, 'getBoundingClientRect').mockReturnValue(box(50));
    const order: string[] = [];
    document.execCommand = jest.fn(() => {
      order.push(document.getSelection()!.anchorNode!.textContent!);
      return true;
    });
    checkWholePoem(view(), jest.fn()); // the stand-in keeps the text as it is, so no space is ever typed
    jest.advanceTimersByTime(3 * PAUSE_MS);
    expect(order.filter((_, i) => i % 2 === 0)).toEqual(['xv', 'zq', 'wd']);
  });

  it('does nothing to an editor with no words', () => {
    dom.innerHTML = '<p><br></p><p> </p>';
    const cancel = checkWholePoem(view(), jest.fn());
    jest.advanceTimersByTime(PAUSE_MS);
    cancel();
    expect(calls).toEqual([]);
  });

  it('finishes at once when cancelled first, and only once; the other paragraphs are not reached', () => {
    const before = dom.innerHTML;
    const cancel = checkWholePoem(view(), jest.fn());
    cancel();
    expect(calls).toEqual(['stop', ...ONE, 'start']);
    expect(dom.innerHTML).toBe(before);
    jest.advanceTimersByTime(2 * PAUSE_MS);
    cancel();
    expect(calls).toHaveLength(4);
  });

  it('a cancel after it has finished does nothing', () => {
    const cancel = checkWholePoem(view(), jest.fn());
    jest.advanceTimersByTime(2 * PAUSE_MS);
    cancel();
    expect(calls).toEqual(BOTH);
  });

  it('does nothing while a composition is under way', () => {
    fake.composing = true;
    checkWholePoem(view(), jest.fn());
    jest.advanceTimersByTime(2 * PAUSE_MS);
    expect(calls).toEqual([]);
  });

  it.each(['keydown', 'beforeinput', 'compositionstart', 'mousedown'])(
    "a %s in the editor finishes it before the poet's input lands",
    (type) => {
      const before = dom.innerHTML;
      checkWholePoem(view(), jest.fn());
      jest.advanceTimersByTime(PAUSE_MS);
      dom.dispatchEvent(new Event(type, { bubbles: true }));
      expect(calls).toEqual(BOTH);
      expect(dom.innerHTML).toBe(before);
      jest.advanceTimersByTime(PAUSE_MS);
      expect(calls).toEqual(BOTH);
    }
  );

  it('stops listening once it has finished', () => {
    checkWholePoem(view(), jest.fn());
    jest.advanceTimersByTime(2 * PAUSE_MS);
    dom.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(calls).toEqual(BOTH);
  });

  it('stops at a paragraph whose text has been replaced meanwhile by an identical one', () => {
    const second = dom.querySelectorAll('p')[1];
    checkWholePoem(view(), jest.fn());
    second.replaceChild(document.createTextNode('xq'), second.firstChild!);
    jest.advanceTimersByTime(2 * PAUSE_MS);
    expect(calls).toEqual(['stop', ...ONE, 'start']);
    expect(texts()).toEqual(['Zq wrd', 'xq']);
  });
});

describe('checkParagraphs', () => {
  it('edits only the paragraphs it is given', () => {
    checkParagraphs(view(), [dom.querySelectorAll('p')[1]], jest.fn());
    expect(texts()).toEqual(['Zq wrd', 'xq ']);
    jest.advanceTimersByTime(PAUSE_MS);
    expect(calls).toEqual(['stop', ...ONE, 'start']);
  });

  it('does nothing outside the document', () => {
    dom.remove();
    checkParagraphs(view(), Array.from(dom.children), jest.fn());
    expect(calls).toEqual([]);
  });
});

describe('checkWholePoemSoon', () => {
  it('checks at FIRST_MS and again at AGAIN_MS, and not before', () => {
    checkWholePoemSoon(view(), jest.fn());
    jest.advanceTimersByTime(FIRST_MS - 1);
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(1 + 2 * PAUSE_MS);
    expect(calls).toEqual(BOTH);
    jest.advanceTimersByTime(AGAIN_MS - FIRST_MS - 2 * PAUSE_MS - 1);
    expect(calls).toHaveLength(6);
    jest.advanceTimersByTime(1 + 2 * PAUSE_MS);
    expect(calls).toEqual([...BOTH, ...BOTH]);
  });

  it('cancelled before it starts, it never touches the editor', () => {
    const cancel = checkWholePoemSoon(view(), jest.fn());
    cancel();
    jest.advanceTimersByTime(AGAIN_MS + 2 * PAUSE_MS);
    expect(calls).toEqual([]);
  });

  it('cancelled during a check, it finishes that one and starts no other', () => {
    const before = dom.innerHTML;
    const cancel = checkWholePoemSoon(view(), jest.fn());
    jest.advanceTimersByTime(FIRST_MS);
    expect(calls).toEqual(['stop', 'insertText " "']);
    cancel();
    expect(calls).toEqual(['stop', ...ONE, 'start']);
    expect(dom.innerHTML).toBe(before);
    jest.advanceTimersByTime(AGAIN_MS + 2 * PAUSE_MS);
    expect(calls).toHaveLength(4);
  });

  it('starts no check once the poem has changed', () => {
    checkWholePoemSoon(view(), jest.fn());
    jest.advanceTimersByTime(FIRST_MS + 2 * PAUSE_MS);
    expect(calls).toEqual(BOTH);
    fake.state.doc = {};
    jest.advanceTimersByTime(AGAIN_MS);
    expect(calls).toEqual(BOTH);
  });
});

// With a real editor: what happens when the DOM is not as the insert left it (Silas, review of #250), and the
// lines around a line break.
describe('in a real editor', () => {
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

  describe('checkWholePoem', () => {
    it('takes every space out when nothing else happened, and nothing changes the poem or its history', () => {
      const seen = transactions();
      const depth = undoDepth(editor.state);
      const log = jest.fn();
      checkWholePoem(editor.view, log);
      expect(paragraphs()).toEqual(['Zq wrd ', 'xq']);
      jest.advanceTimersByTime(PAUSE_MS);
      expect(paragraphs()).toEqual(['Zq wrd', 'xq ']);
      jest.advanceTimersByTime(PAUSE_MS);
      expect(paragraphs()).toEqual(['Zq wrd', 'xq']);
      // Putting the selection back is read as a selection, which changes no document.
      expect(seen.filter((t) => t.docChanged)).toEqual([]);
      expect(undoDepth(editor.state)).toBe(depth);
      expect(log).not.toHaveBeenCalled();
    });

    it('when a transaction renders meanwhile, deletes nothing, edits no further paragraph, redraws and logs', () => {
      const log = jest.fn();
      const depth = undoDepth(editor.state);
      checkWholePoem(editor.view, log);
      editor.commands.setContent('<p>Zq other</p><p>xq</p>');
      const changed = undoDepth(editor.state);
      jest.advanceTimersByTime(2 * PAUSE_MS);
      expect(calls).toEqual(['insertText " "']);
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
      jest.advanceTimersByTime(2 * PAUSE_MS);
      expect(calls).toEqual(['insertText " "']);
      expect(field.value).toBe('zq');
      expect(paragraphs()).toEqual(['Zq wrd', 'xq']);
      expect(log).toHaveBeenCalledWith(MISMATCH_LOG);
      field.remove();
    });
  });

  describe('checkLinesAfterBreaks', () => {
    // Where each insert went: the paragraph's text just before the space.
    const edited = () => {
      const where: string[] = [];
      const stand = document.execCommand;
      document.execCommand = jest.fn((command, ui, value) => {
        if (command === 'insertText')
          where.push(document.getSelection()!.anchorNode!.textContent!);
        return stand(command, ui, value);
      });
      return where;
    };
    const breakAfterFirst = () =>
      editor.commands.setContent('<p>Zq wrd</p><p>vb</p><p>xq</p>');

    it('after the poem gains a line and the poet pauses, checks the line with the caret and the one before', () => {
      const where = edited();
      const lines = checkLinesAfterBreaks(editor.view, jest.fn());
      breakAfterFirst();
      editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 2);
      lines.changed();
      jest.advanceTimersByTime(BREAK_PAUSE_MS - 1);
      expect(where).toEqual([]);
      jest.advanceTimersByTime(1 + 2 * PAUSE_MS);
      expect(where).toEqual(['Zq wrd', 'vb']);
      expect(paragraphs()).toEqual(['Zq wrd', 'vb', 'xq']);
    });

    it('with the caret on the first line, checks that line alone', () => {
      const where = edited();
      const lines = checkLinesAfterBreaks(editor.view, jest.fn());
      breakAfterFirst();
      editor.commands.setTextSelection(1);
      lines.changed();
      jest.advanceTimersByTime(BREAK_PAUSE_MS + 2 * PAUSE_MS);
      expect(where).toEqual(['Zq wrd']);
    });

    it('checks nothing for a change that keeps the number of lines', () => {
      const lines = checkLinesAfterBreaks(editor.view, jest.fn());
      editor.commands.setContent('<p>Zq other</p><p>xq</p>');
      lines.changed();
      jest.advanceTimersByTime(BREAK_PAUSE_MS + 2 * PAUSE_MS);
      expect(calls).toEqual([]);
    });

    it('waits until the poet has paused: each change meanwhile starts the wait again', () => {
      const lines = checkLinesAfterBreaks(editor.view, jest.fn());
      breakAfterFirst();
      lines.changed();
      jest.advanceTimersByTime(BREAK_PAUSE_MS - 1);
      lines.changed();
      jest.advanceTimersByTime(BREAK_PAUSE_MS - 1);
      expect(calls).toEqual([]);
      jest.advanceTimersByTime(1);
      expect(calls).toEqual(['insertText " "']);
    });

    it('checks once per break: a later change with the same lines checks nothing more', () => {
      const lines = checkLinesAfterBreaks(editor.view, jest.fn());
      breakAfterFirst();
      lines.changed();
      jest.advanceTimersByTime(BREAK_PAUSE_MS + 2 * PAUSE_MS);
      const once = calls.length;
      lines.changed();
      jest.advanceTimersByTime(BREAK_PAUSE_MS + 2 * PAUSE_MS);
      expect(calls).toHaveLength(once);
    });

    it('cancel stops a check that has not started, and finishes one that has', () => {
      const lines = checkLinesAfterBreaks(editor.view, jest.fn());
      breakAfterFirst();
      lines.changed();
      lines.cancel();
      jest.advanceTimersByTime(BREAK_PAUSE_MS + 2 * PAUSE_MS);
      expect(calls).toEqual([]);

      const again = checkLinesAfterBreaks(editor.view, jest.fn());
      editor.commands.setContent('<p>Zq wrd</p>');
      again.changed();
      jest.advanceTimersByTime(BREAK_PAUSE_MS);
      expect(calls).toEqual(['insertText " "']);
      again.cancel();
      expect(calls).toEqual(['insertText " "', 'delete']);
      expect(paragraphs()).toEqual(['Zq wrd']);
    });
  });
});
