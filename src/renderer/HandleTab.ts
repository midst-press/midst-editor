import { Extension } from '@tiptap/core';

export const HandleTab = Extension.create({
  name: 'handleTab',
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.insertContent('\t'),
    };
  },
});
