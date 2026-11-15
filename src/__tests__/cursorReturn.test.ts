/** @jest-environment jsdom */
import type { Editor } from '@tiptap/core';
import { FONT_PICKER_CLASS } from '../renderer/poemFont/FontPicker';

// Where the cursor and the page were, kept through a reload of the window (editor #238, Annelyse's case 5). A
// fresh copy of the module stands for the reloaded page: its memory is empty, and only sessionStorage remains.

type Module = typeof import('../renderer/components/Editor/cursorReturn');
const freshModule = (): Module => {
  let mod: Module | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    mod = require('../renderer/components/Editor/cursorReturn');
  });
  return mod!;
};

const fakeEditor = (html: string, anchor = 3, head = 5, scrollTop = 0) => {
  const dom = { scrollTop };
  const editor = {
    isDestroyed: false,
    getHTML: () => html,
    state: { selection: { anchor, head } },
    view: { dom, focus: jest.fn() },
    commands: { setTextSelection: jest.fn(), scrollIntoView: jest.fn() },
  };
  return {
    editor: editor as unknown as Editor,
    dom,
    commands: editor.commands,
    view: editor.view,
  };
};

beforeEach(() => {
  window.sessionStorage.clear();
  jest
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
});

afterEach(() => jest.restoreAllMocks());

it('keeps the cursor and the scroll position through a reload, and uses them once', () => {
  const before = fakeEditor('<p>zq xv</p>', 3, 5, 420);
  freshModule().rememberCursor(before.editor, { acrossReload: true });

  const reloaded = freshModule();
  const after = fakeEditor('<p>zq xv</p>');
  expect(reloaded.restoreCursor(after.editor)).toBe(true);
  expect(after.commands.setTextSelection).toHaveBeenCalledWith({
    from: 3,
    to: 5,
  });
  expect(after.view.focus).toHaveBeenCalled();
  expect(after.commands.scrollIntoView).toHaveBeenCalled();
  expect(after.dom.scrollTop).toBe(420);

  // Used once: a second restore finds nothing.
  expect(reloaded.restoreCursor(fakeEditor('<p>zq xv</p>').editor)).toBe(false);
});

it('without acrossReload, a reload forgets it, and the in-memory return leaves the scroll to the cursor', () => {
  const mod = freshModule();
  mod.rememberCursor(fakeEditor('<p>zq</p>', 1, 1, 300).editor);
  expect(window.sessionStorage.length).toBe(0);
  expect(freshModule().restoreCursor(fakeEditor('<p>zq</p>').editor)).toBe(
    false
  );

  mod.rememberCursor(fakeEditor('<p>zq</p>', 1, 1, 300).editor);
  const back = fakeEditor('<p>zq</p>');
  expect(mod.restoreCursor(back.editor)).toBe(true);
  // One frame, the focus's (#516); no second one restoring a scroll position.
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  expect(back.view.focus).toHaveBeenCalled();
  expect(back.dom.scrollTop).toBe(0);
});

it('puts nothing back into a different poem', () => {
  freshModule().rememberCursor(fakeEditor('<p>zq</p>').editor, {
    acrossReload: true,
  });
  const other = fakeEditor('<p>xv</p>');
  expect(freshModule().restoreCursor(other.editor)).toBe(false);
  expect(other.commands.setTextSelection).not.toHaveBeenCalled();
});

it('treats an unreadable kept place as nothing kept', () => {
  window.sessionStorage.setItem('midst-cursor-return', '{not json');
  const editor = fakeEditor('<p>zq</p>');
  expect(freshModule().restoreCursor(editor.editor)).toBe(false);
  expect(window.sessionStorage.getItem('midst-cursor-return')).toBeNull();
});

// #516: the return from Replay focuses on the next frame too, and gives way to a focus keeper that has it by then.
it('puts the cursor back but leaves the focus with the font picker if it has it by the next frame', () => {
  const mod = freshModule();
  mod.rememberCursor(fakeEditor('<p>zq</p>', 1, 1).editor);
  const picker = document.createElement('div');
  picker.className = FONT_PICKER_CLASS;
  const search = document.createElement('input');
  picker.appendChild(search);
  document.body.appendChild(picker);
  search.focus();
  const after = fakeEditor('<p>zq</p>');
  expect(mod.restoreCursor(after.editor)).toBe(true);
  expect(after.commands.setTextSelection).toHaveBeenCalled();
  expect(after.view.focus).not.toHaveBeenCalled();
  picker.remove();
});
