import { Editor } from '@tiptap/core';
import poemExtensions from '@midst-press/midst-format/extensions';
import {
  AGAIN_MS,
  FIRST_MS,
  MISMATCH_LOG,
  PAUSE_MS,
  checkWholePoemSoon,
} from '../renderer/spellcheck/checkWholePoem';

// Issue #380: on a poem long enough that the first whole-poem check is still running at AGAIN_MS, the second
// started over it; each then found the other's space, so both stopped, redrew the poem and logged, and only about
// the first 42 paragraphs were ever checked. With a real editor; jsdom has no editing commands, so execCommand
// stands in for Chromium's insertText and delete at a collapsed selection in a text node, as in
// checkWholePoem.test.ts. Invented letters only.

const LONG = 80; // the first check takes FIRST_MS + 80 * PAUSE_MS = 2650 ms, past AGAIN_MS
const SHORT = 30; // the first check is over by 1150 ms

// How many spaces have been typed into each paragraph, by its index in the poem.
let typed: number[];
let editor: Editor;

const paragraphs = () => Array.from(editor.view.dom.querySelectorAll('p'));
const texts = () => paragraphs().map((p) => p.textContent);

const open = (lines: number) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const content = Array.from({ length: lines }, (_, i) => `<p>zq${i}</p>`).join(
    ''
  );
  editor = new Editor({ element, extensions: poemExtensions, content });
  typed = Array(lines).fill(0);
};

beforeEach(() => {
  jest.useFakeTimers();
  document.execCommand = jest.fn(
    (command: string, _ui?: boolean, value?: string) => {
      const sel = document.getSelection()!;
      const node = sel.anchorNode as Text;
      const at = sel.anchorOffset;
      if (command === 'insertText') {
        typed[paragraphs().findIndex((p) => p.contains(node))] += 1;
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
  editor.destroy();
  jest.useRealTimers();
});

it('on a long poem the second check waits for the first, and both reach every paragraph without a redraw', () => {
  open(LONG);
  const before = texts();
  const log = jest.fn();
  checkWholePoemSoon(editor.view, log);

  // At AGAIN_MS the first is on its 42nd paragraph, and no second check has typed anywhere.
  jest.advanceTimersByTime(AGAIN_MS + PAUSE_MS);
  expect(typed.reduce((a, b) => a + b)).toBe(
    Math.floor((AGAIN_MS + PAUSE_MS - FIRST_MS) / PAUSE_MS) + 1
  );
  expect(typed.every((n) => n <= 1)).toBe(true);

  jest.advanceTimersByTime(2 * LONG * PAUSE_MS);
  expect(typed).toEqual(Array(LONG).fill(2));
  // Any mismatch, whatever its reason: an exact match on MISMATCH_LOG alone would pass with one logged.
  expect(
    log.mock.calls.filter(([m]) => String(m).startsWith(MISMATCH_LOG))
  ).toEqual([]);
  expect(texts()).toEqual(before);
});

it('on a short poem the second still starts at AGAIN_MS, as before', () => {
  open(SHORT);
  checkWholePoemSoon(editor.view, jest.fn());
  jest.advanceTimersByTime(AGAIN_MS - 1);
  expect(typed).toEqual(Array(SHORT).fill(1));
  jest.advanceTimersByTime(1 + SHORT * PAUSE_MS);
  expect(typed).toEqual(Array(SHORT).fill(2));
});

it('a first check ended by the poet after AGAIN_MS is not followed by a second', () => {
  open(LONG);
  checkWholePoemSoon(editor.view, jest.fn());
  jest.advanceTimersByTime(AGAIN_MS + PAUSE_MS);
  const reached = typed.reduce((a, b) => a + b);
  editor.view.dom.dispatchEvent(new Event('keydown', { bubbles: true }));
  jest.advanceTimersByTime(2 * LONG * PAUSE_MS);
  expect(typed.reduce((a, b) => a + b)).toBe(reached);
});

it('cancelled while the second is waiting, it finishes the first and starts no second', () => {
  open(LONG);
  const before = texts();
  const cancel = checkWholePoemSoon(editor.view, jest.fn());
  jest.advanceTimersByTime(AGAIN_MS + PAUSE_MS);
  const reached = typed.reduce((a, b) => a + b);
  cancel();
  expect(texts()).toEqual(before);
  jest.advanceTimersByTime(2 * LONG * PAUSE_MS);
  expect(typed.reduce((a, b) => a + b)).toBe(reached);
});
