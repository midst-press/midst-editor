import type { EditorView } from '@tiptap/pm/view';

// Chromium checks the spelling of an editable only once it has been edited (GitHub #71, issue #238). Switching
// spellcheck on reloads the window with spellcheck="true", and no word was marked until the poet typed. Neither
// focus, nor setting the attribute again, nor re-enabling the checker, nor new DOM nodes makes it look: an edit
// does, and then it checks the whole poem.
//
// So this makes an edit Chromium counts and nobody keeps: it types a space at the end of the poem's first text
// and deletes it again a little later. ProseMirror's DOM observer is stopped from before the space to after the
// delete, so no transaction comes of either, and the poem's history never holds them. The DOM is the same
// afterwards, and the poet's selection is put back.
//
// The delete has to wait: in the same task Chromium sees no edit (measured: 0 marks; 16 ms later, every
// misspelled word). PAUSE_MS is a margin over that.
//
// Undo cannot replay the space: the native undo stack holds it, but prosemirror-history takes every
// historyUndo/historyRedo beforeinput and prevents its default, so the native one never runs.

export const PAUSE_MS = 50;

export const MISMATCH_LOG =
  'spellcheck: the editor changed while its spelling was being checked';

// ProseMirror's DOM observer is internal; these are the two calls this needs from it.
type Observed = { domObserver: { stop(): void; start(): void } };

/** The first text node in `root` that has text, or null. */
function firstText(root: HTMLElement): Text | null {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.textContent ?? '') !== '') return node as Text;
  }
  return null;
}

/**
 * Has Chromium check the spelling of the whole editable now, without changing the poem. Returns a function that
 * cancels it if it has not finished (the window is going away). `log` hears only the fixed MISMATCH_LOG.
 */
export default function checkWholePoem(
  view: EditorView,
  /* eslint-disable-next-line no-unused-vars -- a type's parameter name, not a variable */
  log: (message: string) => void
): () => void {
  const { dom } = view;
  const doc = dom.ownerDocument;
  const text = firstText(dom);
  const selection = doc.getSelection();
  // Not in the document yet, there is no edit Chromium could see; with no text, nothing to check.
  if (!dom.isConnected || !text || !selection) return () => {};

  const observer = (view as unknown as Observed).domObserver;
  const kept = Array.from({ length: selection.rangeCount }, (_, i) =>
    selection.getRangeAt(i).cloneRange()
  );
  const before = dom.innerHTML;
  const restore = () => {
    selection.removeAllRanges();
    kept.forEach((range) => selection.addRange(range));
    observer.start();
  };

  observer.stop();
  const caret = doc.createRange();
  caret.setStart(text, (text.textContent ?? '').length);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  doc.execCommand('insertText', false, ' ');

  let done = false;
  const finish = () => {
    done = true;
    doc.execCommand('delete', false);
    if (dom.innerHTML !== before) log(MISMATCH_LOG);
    restore();
  };
  const timer = setTimeout(finish, PAUSE_MS);
  return () => {
    if (done) return;
    clearTimeout(timer);
    finish();
  };
}
