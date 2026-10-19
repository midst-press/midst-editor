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
// Undo cannot replay the space: the native undo stack holds it, but prosemirror-history takes every
// historyUndo/historyRedo beforeinput and prevents its default, so the native one never runs.

export const PAUSE_MS = 50;
export const FIRST_MS = 250;
export const AGAIN_MS = 1500;

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

/**
 * Has Chromium check the spelling of the whole editable now, without changing the poem. Returns a function that
 * finishes it at once if it has not finished (the editor is going away). `log` hears only the fixed MISMATCH_LOG.
 */
export default function checkWholePoem(view: EditorView, log: Log): () => void {
  const { dom } = view;
  const doc = dom.ownerDocument;
  const text = firstText(dom);
  const selection = doc.getSelection();
  // Not in the document, there is no edit Chromium could see; with no text, nothing to check.
  if (!dom.isConnected || !text || !selection) return () => {};

  const observer = (view as unknown as Observed).domObserver;
  const kept = Array.from({ length: selection.rangeCount }, (_, i) =>
    selection.getRangeAt(i).cloneRange()
  );
  const before = dom.innerHTML;

  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    INPUT_EVENTS.forEach((type) => dom.removeEventListener(type, finish, true));
    doc.execCommand('delete', false);
    if (dom.innerHTML !== before) log(MISMATCH_LOG);
    selection.removeAllRanges();
    kept.forEach((range) => selection.addRange(range));
    observer.start();
  };

  observer.stop();
  INPUT_EVENTS.forEach((type) => dom.addEventListener(type, finish, true));
  const caret = doc.createRange();
  caret.setStart(text, text.data.length);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  doc.execCommand('insertText', false, ' ');
  timer = setTimeout(finish, PAUSE_MS);
  return finish;
}

/** checkWholePoem at FIRST_MS and again at AGAIN_MS. Returns a function that cancels what has not run. */
export function checkWholePoemSoon(view: EditorView, log: Log): () => void {
  let finishRunning = () => {};
  const timers = [FIRST_MS, AGAIN_MS].map((ms) =>
    setTimeout(() => {
      finishRunning = checkWholePoem(view, log);
    }, ms)
  );
  return () => {
    timers.forEach(clearTimeout);
    finishRunning();
  };
}
