import type { Editor } from '@tiptap/core';
import KEEPS_FOCUS from '../../keepsFocus';
import { FIND_BAR_CLASS } from '../../search/FindBar';
import { FONT_PICKER_CLASS } from '../../poemFont/FontPicker';

// The find bar, the font picker and anything marked KEEPS_FOCUS take the focus on purpose: the editor must not
// take it from them, or the poet cannot type there, the font picker's Escape never reaches it (GitHub #112,
// editor #417), and what was typed goes into the poem (GitHub #119).
export const FOCUS_KEEPERS = `.${FIND_BAR_CLASS}, .${FONT_PICKER_CLASS}, [${KEEPS_FOCUS}]`;

export const keepsFocus = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(FOCUS_KEEPERS) !== null;

/**
 * Focus the editor on the next animation frame, as tiptap's focus() does, unless by then one of the focus keepers
 * has the focus. tiptap decides at the call and moves the focus a frame later; a frame can come late (a window
 * that is not being drawn waits for one), and View > Font… opened in between lost its search field to the poem
 * (#516). So the decision is made in the same frame as the move.
 */
export function focusUnlessKept(editor: Editor): void {
  window.requestAnimationFrame(() => {
    if (editor.isDestroyed || keepsFocus(document.activeElement)) return;
    editor.view.focus();
    editor.commands.scrollIntoView();
  });
}
