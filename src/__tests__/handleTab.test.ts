import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { compareStrings, reconstruct } from '@midst-press/midst-format/history';
import HandleTab from '../renderer/HandleTab';

// Synthetic text only: invented words, never a poem.
//
// Poets use Tab for spacing. Without this extension the Tab key inserts nothing in the editor (the
// browser would move focus away), so these tests run the key through a real TipTap editor.

const editors: Editor[] = [];
const makeEditor = (withHandleTab: boolean, content = '<p>zq</p>') => {
  const editor = new Editor({
    extensions: withHandleTab ? [StarterKit, HandleTab] : [StarterKit],
    content,
    // As the app's editor parses a poem (Editor/index.tsx), so a tab in the content stays a tab.
    parseOptions: { preserveWhitespace: true },
  });
  editors.push(editor);
  return editor;
};

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('the Tab key in the editor', () => {
  it('inserts a tab character where the cursor is', () => {
    const editor = makeEditor(true);
    editor.commands.focus('end');
    expect(editor.commands.keyboardShortcut('Tab')).toBe(true);
    expect(editor.getText()).toBe('zq\t');

    editor.commands.setTextSelection(2);
    editor.commands.keyboardShortcut('Tab');
    expect(editor.getText()).toBe('z\tq\t');
  });

  it('replaces the selected text with a tab', () => {
    const editor = makeEditor(true);
    editor.commands.setTextSelection({ from: 1, to: 3 });
    editor.commands.keyboardShortcut('Tab');
    expect(editor.getText()).toBe('\t');
  });

  // CONTROL -- the tab comes from HandleTab, not from TipTap's own handling of the key.
  it('inserts nothing without the extension', () => {
    const editor = makeEditor(false);
    editor.commands.focus('end');
    editor.commands.keyboardShortcut('Tab');
    expect(editor.getText()).toBe('zq');
  });
});

// Annelyse, GitHub #30 (editor #431): Shift-Tab takes a tab away, and Tab over several lines indents each of them,
// without changing a Tab partway through a line.
describe('Tab over several lines, and Shift-Tab', () => {
  const lines = (editor: Editor) => editor.getText({ blockSeparator: '|' });
  // Positions: <p>zq</p><p>xv</p><p>qz</p> puts the text at 1-3, 5-7 and 9-11.
  const THREE = '<p>zq</p><p>xv</p><p>qz</p>';

  it('puts a tab at the start of each selected line, and keeps the selection over the same text', () => {
    const editor = makeEditor(true, THREE);
    editor.commands.setTextSelection({ from: 2, to: 6 });
    expect(editor.commands.keyboardShortcut('Tab')).toBe(true);
    expect(lines(editor)).toBe('\tzq|\txv|qz');
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('q\tx');
  });

  it('leaves out a line the selection ends at the very start of', () => {
    const editor = makeEditor(true, THREE);
    editor.commands.setTextSelection({ from: 1, to: 9 });
    editor.commands.keyboardShortcut('Tab');
    expect(lines(editor)).toBe('\tzq|\txv|qz');
  });

  it('indents every line under Select All', () => {
    const editor = makeEditor(true, THREE);
    editor.commands.selectAll();
    editor.commands.keyboardShortcut('Tab');
    expect(lines(editor)).toBe('\tzq|\txv|\tqz');
  });

  it('counts a line break inside a paragraph as a new line', () => {
    const editor = makeEditor(true, '<p>zq<br>xv</p>');
    // zq is 1-3, the break is at 3, xv is 4-6.
    editor.commands.setTextSelection({ from: 2, to: 5 });
    editor.commands.keyboardShortcut('Tab');
    expect(editor.getText()).toBe('\tzq\n\txv');
  });

  it('is one change: one Undo takes every tab away again', () => {
    const editor = makeEditor(true, THREE);
    editor.commands.selectAll();
    editor.commands.keyboardShortcut('Tab');
    editor.commands.undo();
    expect(lines(editor)).toBe('zq|xv|qz');
  });

  it('still puts a single tab partway through a line, with a selection inside one line', () => {
    const editor = makeEditor(true, THREE);
    editor.commands.setTextSelection(6);
    editor.commands.keyboardShortcut('Tab');
    expect(lines(editor)).toBe('zq|x\tv|qz');
  });

  it('Shift-Tab takes away the tab just before the cursor, partway through a line', () => {
    const editor = makeEditor(true, '<p>z\tq</p>');
    editor.commands.setTextSelection(3);
    expect(editor.commands.keyboardShortcut('Shift-Tab')).toBe(true);
    expect(editor.getText()).toBe('zq');
  });

  it('Shift-Tab with no tab before the cursor takes one from the start of the line', () => {
    const editor = makeEditor(true, '<p>\t\tzq</p>');
    editor.commands.setTextSelection(5);
    editor.commands.keyboardShortcut('Shift-Tab');
    expect(editor.getText()).toBe('\tzq');
  });

  it('Shift-Tab finds the start of the line even with a line break after the cursor', () => {
    const editor = makeEditor(true, '<p>\tzq<br>xv</p>');
    // The tab is 1-2, z at 2, q at 3: the cursor between z and q, the break after it.
    editor.commands.setTextSelection(3);
    editor.commands.keyboardShortcut('Shift-Tab');
    expect(editor.getText()).toBe('zq\nxv');
  });

  it('Shift-Tab on the line after a line break takes the tab from the start of that line', () => {
    const editor = makeEditor(true, '<p>zq<br>\txv</p>');
    // z at 1, q at 2, the break at 3, the tab at 4, x at 5: the cursor between x and v.
    editor.commands.setTextSelection(6);
    editor.commands.keyboardShortcut('Shift-Tab');
    expect(editor.getText()).toBe('zq\nxv');
  });

  it('Shift-Tab over several lines takes one tab from the start of each line that has one', () => {
    const editor = makeEditor(true, '<p>\tzq</p><p>xv</p><p>\t\tqz</p>');
    editor.commands.selectAll();
    editor.commands.keyboardShortcut('Shift-Tab');
    expect(lines(editor)).toBe('zq|xv|\tqz');
  });

  it('Shift-Tab with no tab to take changes nothing, and keeps the key', () => {
    const editor = makeEditor(true, THREE);
    editor.commands.setTextSelection(6);
    expect(editor.commands.keyboardShortcut('Shift-Tab')).toBe(true);
    expect(lines(editor)).toBe('zq|xv|qz');
  });

  // One key changes several places at once; the history records one change per update (Editor onUpdate), and the
  // Timeline rebuilds the poem from those changes. Both directions must rebuild exactly.
  it('a several-line Tab and Shift-Tab are recorded so the Timeline rebuilds them exactly', () => {
    const editor = makeEditor(true, THREE);
    const start = editor.getHTML();
    editor.commands.selectAll();
    editor.commands.keyboardShortcut('Tab');
    const indented = editor.getHTML();
    editor.commands.keyboardShortcut('Shift-Tab');
    const back = editor.getHTML();
    const changes = [
      compareStrings(start, indented, editor.state.selection.from),
      compareStrings(indented, back, editor.state.selection.from),
    ];
    expect(reconstruct(start, changes, 0)).toBe(indented);
    expect(reconstruct(start, changes, 1)).toBe(back);
  });

  it('Tab then Shift-Tab over several lines puts them back as they were', () => {
    const editor = makeEditor(true, THREE);
    editor.commands.selectAll();
    editor.commands.keyboardShortcut('Tab');
    editor.commands.keyboardShortcut('Shift-Tab');
    expect(lines(editor)).toBe('zq|xv|qz');
  });
});
