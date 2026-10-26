import Strike from '@tiptap/extension-strike';
import poemExtensions from '@midst-press/midst-format/extensions';

// The poem schema (midst-format) for the writing editor, with one change: strikethrough's key. TipTap's strike
// extension binds Mod-Shift-S, which is Save As in the File menu (menu.ts). A key the page handles never reaches the
// menu on Windows and Linux, so nothing here binds it: StarterKit's strike is left out and the same mark is added back
// with Mod-Shift-X only (#140). The schema is unchanged, so what the editor writes is what midst-format reads.
const editorExtensions = [
  ...poemExtensions.map((extension) =>
    extension.name === 'starterKit'
      ? extension.configure({ strike: false })
      : extension
  ),
  Strike.extend({
    addKeyboardShortcuts() {
      return { 'Mod-Shift-x': () => this.editor.commands.toggleStrike() };
    },
  }),
];

export default editorExtensions;
