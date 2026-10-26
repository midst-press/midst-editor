import { Editor } from '@tiptap/core';

// Where the cursor was when the poet left the editor (GitHub #24). Going to Replay unmounts the editor, and
// coming back makes a new one from the stored poem, which would start with the cursor at the top. The
// selection is kept here, in memory only, with the text it belongs to: it is put back only into that same
// text, so a different poem, or one that changed while the editor was away, starts as before.
//
// The spellcheck toggle reloads the window (editor #238, Annelyse's case 5), which empties memory, so that one
// place is also kept in sessionStorage, which a reload keeps, with the editor's scroll position.
type Place = { html: string; anchor: number; head: number; scrollTop?: number };
let left: Place | null = null;
const ACROSS_RELOAD = 'midst-cursor-return';

/** Remember where the cursor is, as the editor is left; `acrossReload` keeps it through a reload of the window. */
export function rememberCursor(editor: Editor, { acrossReload = false } = {}) {
  const { anchor, head } = editor.state.selection;
  left = { html: editor.getHTML(), anchor, head };
  // Only the reload keeps the scroll position: the editor is still on the page then. Leaving for Replay
  // unmounts it, and the cursor is scrolled into view on the way back, as before.
  if (acrossReload)
    window.sessionStorage.setItem(
      ACROSS_RELOAD,
      JSON.stringify({ ...left, scrollTop: editor.view.dom.scrollTop })
    );
}

const keptAcrossReload = (): Place | null => {
  const kept = window.sessionStorage.getItem(ACROSS_RELOAD);
  window.sessionStorage.removeItem(ACROSS_RELOAD);
  try {
    return kept === null ? null : (JSON.parse(kept) as Place);
  } catch {
    return null;
  }
};

/**
 * Put the remembered cursor back, focus the editor and scroll the cursor into view, if this editor holds the
 * text it was left in. Used once: what was remembered is forgotten either way. Returns whether it did.
 */
export function restoreCursor(editor: Editor): boolean {
  const kept = keptAcrossReload();
  const was = left ?? kept;
  left = null;
  if (was === null || was.html !== editor.getHTML()) return false;
  // setTextSelection keeps the positions inside the document; focus() then scrolls the cursor into view, and
  // the page is put back where it was, which may not be at the cursor.
  editor.commands.setTextSelection({ from: was.anchor, to: was.head });
  editor.commands.focus();
  const { scrollTop } = was;
  if (typeof scrollTop === 'number') {
    const { dom } = editor.view;
    window.requestAnimationFrame(() => {
      dom.scrollTop = scrollTop;
    });
  }
  return true;
}
