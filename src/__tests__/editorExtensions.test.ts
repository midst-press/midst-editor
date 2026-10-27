import { Editor, getSchema } from '@tiptap/core';
import poemExtensions from '@midst-press/midst-format/extensions';
import editorExtensions from '../renderer/editorExtensions';

// Synthetic text only. The writing editor's extensions are the poem schema with strikethrough on Mod-Shift-X, and
// nothing bound to Mod-Shift-S, which is Save As (#140).

const editors: Editor[] = [];
const makeEditor = (extensions: typeof editorExtensions) => {
  const editor = new Editor({ extensions, content: '<p>zq</p>' });
  editor.commands.setTextSelection({ from: 1, to: 3 });
  editors.push(editor);
  return editor;
};

// Whether the editor handles a Ctrl+Shift keydown (jsdom is not a Mac, so Mod is Ctrl; the key as the keymap matches it). A handled key is
// preventDefault-ed, and then the menu never sees it on Windows and Linux. keyboardShortcut()'s own return value
// says nothing about this: it is true whether or not a binding ran.
const handles = (editor: Editor, key: string) =>
  editor.view.someProp('handleKeyDown', (handle) =>
    handle(
      editor.view,
      new KeyboardEvent('keydown', { key, shiftKey: true, ctrlKey: true })
    )
  ) ?? false;

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

it('has the same schema as midst-format, so what it writes is what the format reads', () => {
  const ours = getSchema(editorExtensions);
  const theirs = getSchema(poemExtensions);
  // In order: the order of the marks decides how they nest in the written HTML.
  expect(Object.keys(ours.marks)).toEqual(Object.keys(theirs.marks));
  expect(Object.keys(ours.nodes).sort()).toEqual(
    Object.keys(theirs.nodes).sort()
  );
  const rules = (s: typeof ours) =>
    (s.marks.strike.spec.parseDOM ?? []).map((rule) => ({
      tag: 'tag' in rule ? rule.tag : undefined,
      style: 'style' in rule ? rule.style : undefined,
    }));
  expect(rules(ours)).toEqual(rules(theirs));
});

it('Mod-Shift-X strikes the selection, and again unstrikes it', () => {
  const editor = makeEditor(editorExtensions);
  expect(handles(editor, 'x')).toBe(true);
  expect(editor.getHTML()).toBe('<p><s>zq</s></p>');
  editor.commands.keyboardShortcut('Mod-Shift-x');
  expect(editor.getHTML()).toBe('<p>zq</p>');
});

it('nothing in the editor handles Mod-Shift-S, so the key goes to the menu (Save As)', () => {
  const editor = makeEditor(editorExtensions);
  expect(handles(editor, 's')).toBe(false);
  expect(editor.getHTML()).toBe('<p>zq</p>');
});

// CONTROL -- midst-format's own extensions do bind Mod-Shift-S to strike, so the test above can fail.
it('with midst-format alone, Mod-Shift-S strikes', () => {
  const editor = makeEditor(poemExtensions);
  expect(handles(editor, 's')).toBe(true);
  expect(editor.getHTML()).toBe('<p><s>zq</s></p>');
});

// clement-7074f29f, review of #333: with the marks in another order, the editor wrote <u><s>…</s></u> where
// midst-format writes <s><u>…</u></s>. Same document in, same HTML out.
it('writes underlined struck text as midst-format does', () => {
  const html = '<p><u><s>qq</s></u></p>';
  const write = (extensions: typeof editorExtensions) => {
    const editor = new Editor({ extensions, content: html });
    editors.push(editor);
    return editor.getHTML();
  };
  expect(write(editorExtensions)).toBe(write(poemExtensions));
});
