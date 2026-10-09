import { Extension } from '@tiptap/core';

const HandleTab = Extension.create({
  name: 'handleTab',
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.insertContent('\t'),
    };
  },
});

// Named const plus a default export: the rule wants a default on a single-export file, and the
// binding keeps the symbol greppable and visible in stack traces.
export default HandleTab;
