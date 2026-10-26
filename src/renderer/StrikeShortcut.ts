import { Extension } from '@tiptap/core';

// Strikethrough's own shortcut, Mod-Shift-S, is Save As in the File menu (menu.ts), so strikethrough uses Mod-Shift-X
// (#140). The higher priority makes Mod-Shift-S do nothing in the editor, so the menu's Save As is all it does.
const StrikeShortcut = Extension.create({
  name: 'strikeShortcut',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-Shift-s': () => true,
    };
  },
});

export default StrikeShortcut;
