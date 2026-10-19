import type { EditorView } from '@tiptap/pm/view';
import checkWholePoem, {
  MISMATCH_LOG,
  PAUSE_MS,
} from '../renderer/spellcheck/checkWholePoem';

// src/renderer/spellcheck/checkWholePoem.ts (issue #238): an edit Chromium counts, that ProseMirror never sees
// and the DOM does not keep. jsdom has no editing commands, so execCommand is a stand-in that does what
// Chromium's insertText and delete do at a collapsed selection in a text node. Invented letters only.

let calls: string[];
let dom: HTMLElement;
let observer: { stop: jest.Mock; start: jest.Mock };

const view = () => ({ dom, domObserver: observer } as unknown as EditorView);

beforeEach(() => {
  jest.useFakeTimers();
  calls = [];
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

  it('logs the fixed message, and still restarts the observer, when the editor changed meanwhile', () => {
    const log = jest.fn();
    checkWholePoem(view(), log);
    dom.querySelectorAll('p')[1].append('q');
    jest.advanceTimersByTime(PAUSE_MS);
    expect(log).toHaveBeenCalledWith(MISMATCH_LOG);
    expect(observer.start).toHaveBeenCalledTimes(1);
  });
});
