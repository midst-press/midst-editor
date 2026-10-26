import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import StrikeShortcut from '../renderer/StrikeShortcut';

// Synthetic text only. Strikethrough is Mod-Shift-X, because Mod-Shift-S is Save As (#140).

const editors: Editor[] = [];
const makeEditor = (withShortcut: boolean) => {
  const editor = new Editor({
    extensions: withShortcut ? [StarterKit, StrikeShortcut] : [StarterKit],
    content: '<p>zq</p>',
  });
  editor.commands.setTextSelection({ from: 1, to: 3 });
  editors.push(editor);
  return editor;
};

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('the strikethrough shortcut', () => {
  it('Mod-Shift-X strikes the selection, and again unstrikes it', () => {
    const editor = makeEditor(true);
    editor.commands.keyboardShortcut('Mod-Shift-x');
    expect(editor.getHTML()).toBe('<p><s>zq</s></p>');
    editor.commands.keyboardShortcut('Mod-Shift-x');
    expect(editor.getHTML()).toBe('<p>zq</p>');
  });

  it('Mod-Shift-S does not strike (it is Save As)', () => {
    const editor = makeEditor(true);
    editor.commands.keyboardShortcut('Mod-Shift-s');
    expect(editor.getHTML()).toBe('<p>zq</p>');
  });

  // CONTROL -- without the extension TipTap's own Mod-Shift-S strikes, so the test above can fail.
  it('without the extension, Mod-Shift-S strikes', () => {
    const editor = makeEditor(false);
    editor.commands.keyboardShortcut('Mod-Shift-s');
    expect(editor.getHTML()).toBe('<p><s>zq</s></p>');
  });
});
