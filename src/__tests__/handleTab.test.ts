import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import HandleTab from '../renderer/HandleTab';

// Synthetic text only: invented words, never a poem.
//
// Poets use Tab for spacing. Without this extension the Tab key inserts nothing in the editor (the
// browser would move focus away), so these tests run the key through a real TipTap editor.

const editors: Editor[] = [];
const makeEditor = (withHandleTab: boolean) => {
  const editor = new Editor({
    extensions: withHandleTab ? [StarterKit, HandleTab] : [StarterKit],
    content: '<p>zq</p>',
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
