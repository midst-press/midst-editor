import type { Transaction } from '@tiptap/pm/state';
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
// Measured on #238, by counting red underline pixels:
//   - the delete has to wait: in the same task Chromium sees no edit (0 marks), 16 ms later it does. PAUSE_MS
//     is a margin over that;
//   - and the edit has to come a little after the editor is in the page: two animation frames, the window's
//     load event and the first idle callback were all too early (0 marks); 100 ms and later marked every
//     misspelled word. So checkWholePoemSoon runs it at FIRST_MS, and again at AGAIN_MS for a slower machine.
//
// While the observer is stopped ProseMirror would not see the poet's typing, and the delete could take their
// letter instead of the space. So any key, input, composition or click in the editor finishes the check first:
// the space is deleted and the observer started before the poet's input reaches the page.
//
// The delete is tied to the space (Silas, review of #250). It runs only if the editor's DOM is exactly as the
// insert left it and nothing else has focus, with the caret put back after the space. Anything else (a
// transaction rendered meanwhile, an open-file, the find bar taking focus) means the DOM may no longer be
// ProseMirror's, so nothing is deleted: ProseMirror redraws the editor from its state instead, which drops the
// space wherever it is, and the fixed MISMATCH_LOG is logged. No check starts during a composition, and a later
// one does not start once the poem has changed, since an edit has already made Chromium look.
//
// Undo cannot replay the space: the native undo stack holds it, but prosemirror-history takes every
// historyUndo/historyRedo beforeinput and prevents its default, so the native one never runs.

export const PAUSE_MS = 50;
export const FIRST_MS = 250;
export const AGAIN_MS = 1500;

// Transaction metadata: prosemirror-history leaves out a transaction with addToHistory false, and tiptap emits
// no update (so Midst records nothing) for one with preventUpdate.
const HISTORY_KEY = 'addToHistory';
const UPDATE_KEY = 'preventUpdate';

export const MISMATCH_LOG =
  'spellcheck: the editor changed while its spelling was being checked';

// What the poet does that has to wait for the check to finish.
const INPUT_EVENTS: (keyof HTMLElementEventMap)[] = [
  'keydown',
  'beforeinput',
  'compositionstart',
  'mousedown',
];

// ProseMirror's DOM observer is internal; these are the two calls this needs from it.
type Observed = { domObserver: { stop(): void; start(): void } };
/* eslint-disable-next-line no-unused-vars -- a type's parameter name, not a variable */
type Log = (message: string) => void;

/** The first text node in `root` that has text, or null. */
function firstText(root: HTMLElement): Text | null {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).data !== '') return node as Text;
  }
  return null;
}

/** Rebuild the editor's DOM from ProseMirror's state, out of the history and without an update: replacing the
 *  document with an identical copy keeps its nodes, so it is emptied first (measured on #238). */
export function redrawFromState(view: EditorView): void {
  const { state } = view;
  const bookmark = state.selection.getBookmark();
  const { content } = state.doc;
  const empty = state.schema.topNodeType.createAndFill();
  if (!empty) return;
  const quiet = (tr: Transaction) =>
    tr.setMeta(HISTORY_KEY, false).setMeta(UPDATE_KEY, true);
  view.dispatch(
    quiet(state.tr.replaceWith(0, state.doc.content.size, empty.content))
  );
  const back = view.state.tr.replaceWith(
    0,
    view.state.doc.content.size,
    content
  );
  back.setSelection(bookmark.resolve(back.doc));
  view.dispatch(quiet(back));
}

/**
 * Has Chromium check the spelling of the whole editable now, without changing the poem. Returns a function that
 * finishes it at once if it has not finished (the editor is going away). `log` hears only the fixed MISMATCH_LOG.
 */
export default function checkWholePoem(view: EditorView, log: Log): () => void {
  const { dom } = view;
  const doc = dom.ownerDocument;
  const text = firstText(dom);
  const selection = doc.getSelection();
  // Not in the document, there is no edit Chromium could see; with no text, nothing to check; and a composition
  // is the poet's, not to be interrupted.
  if (!dom.isConnected || !text || !selection || view.composing)
    return () => {};

  const observer = (view as unknown as Observed).domObserver;
  const kept = Array.from({ length: selection.rangeCount }, (_, i) =>
    selection.getRangeAt(i).cloneRange()
  );
  const before = dom.innerHTML;

  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // What the insert left: the DOM, and the caret just after the space.
  let inserted = '';
  let afterSpace: Range | undefined;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    INPUT_EVENTS.forEach((type) => dom.removeEventListener(type, finish, true));
    const focus = doc.activeElement;
    const untouched =
      afterSpace !== undefined &&
      dom.innerHTML === inserted &&
      (focus === dom || focus === doc.body || focus === null);
    if (untouched && afterSpace) {
      selection.removeAllRanges();
      selection.addRange(afterSpace);
      doc.execCommand('delete', false);
    }
    if (dom.innerHTML === before) {
      selection.removeAllRanges();
      kept.forEach((range) => selection.addRange(range));
      observer.start();
      return;
    }
    observer.start();
    redrawFromState(view);
    log(MISMATCH_LOG);
  };

  observer.stop();
  INPUT_EVENTS.forEach((type) => dom.addEventListener(type, finish, true));
  const caret = doc.createRange();
  caret.setStart(text, text.data.length);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  doc.execCommand('insertText', false, ' ');
  inserted = dom.innerHTML;
  if (selection.rangeCount > 0)
    afterSpace = selection.getRangeAt(0).cloneRange();
  timer = setTimeout(finish, PAUSE_MS);
  return finish;
}

/** checkWholePoem at FIRST_MS and again at AGAIN_MS, each only while the poem is as it was when this was called
 *  (once it has changed, Chromium has seen an edit). Returns a function that cancels what has not run. */
export function checkWholePoemSoon(view: EditorView, log: Log): () => void {
  const poem = view.state.doc;
  let finishRunning = () => {};
  const timers = [FIRST_MS, AGAIN_MS].map((ms) =>
    setTimeout(() => {
      if (view.state.doc === poem) finishRunning = checkWholePoem(view, log);
    }, ms)
  );
  return () => {
    timers.forEach(clearTimeout);
    finishRunning();
  };
}
