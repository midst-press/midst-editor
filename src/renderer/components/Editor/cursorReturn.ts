import { Editor } from '@tiptap/core';

// Where the cursor was when the poet left the editor (GitHub #24). Going to Replay unmounts the editor, and
// coming back makes a new one from the stored poem, which would start with the cursor at the top. The
// selection is kept here, in memory only, with the text it belongs to: it is put back only into that same
// text, so a different poem, or one that changed while the editor was away, starts as before.
let left: { html: string; anchor: number; head: number } | null = null;

/** Remember where the cursor is, as the editor is left. */
export function rememberCursor(editor: Editor) {
  const { anchor, head } = editor.state.selection;
  left = { html: editor.getHTML(), anchor, head };
}

/**
 * Put the remembered cursor back, focus the editor and scroll the cursor into view, if this editor holds the
 * text it was left in. Used once: what was remembered is forgotten either way. Returns whether it did.
 */
export function restoreCursor(editor: Editor): boolean {
  const was = left;
  left = null;
  if (was === null || was.html !== editor.getHTML()) return false;
  // setTextSelection keeps the positions inside the document; focus() then scrolls the cursor into view.
  editor.commands.setTextSelection({ from: was.anchor, to: was.head });
  editor.commands.focus();
  return true;
}
