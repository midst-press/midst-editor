import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// Chromium checks the spelling of an editable only where it has been edited (GitHub #71, issue #238). Switching
// spellcheck on reloads the window with spellcheck="true", and no word was marked until the poet typed. Neither
// focus, nor setting the attribute again, nor re-enabling the checker, nor new DOM nodes makes it look, and
// nothing checks the rest when idle: an edit does, and then it checks that edit's paragraph only.
//
// So this makes edits Chromium counts and nobody keeps: in each paragraph in turn it types a space after the last
// word, waits, and deletes it again. ProseMirror's DOM observer is stopped from before the first space to after
// the last delete, so no transaction comes of any of them, and the poem's history never holds them. The DOM is
// the same afterwards, and the poet's selection and scroll position are put back.
//
// Measured on #238, by counting red underline pixels in a poem of 12 misspelled lines:
//   - one edit marks its whole paragraph, the first word as well as the last, and no other paragraph;
//   - each paragraph's space has to stay a moment: deleted at once, or with every paragraph's space typed in one
//     task, only the last paragraph edited was marked. 5 ms between insert and delete marked 3 to 5 lines,
//     10 ms 11 to 12, and 16 ms and 20 ms all 12. PAUSE_MS is a margin over that, about 30 ms a paragraph;
//   - and the first edit has to come a little after the editor is in the page: two animation frames, the
//     window's load event and the first idle callback were all too early (0 marks); 100 ms and later marked.
//     So checkWholePoemSoon runs it at FIRST_MS, and again at AGAIN_MS for a slower machine.
// The paragraphs on screen go first, so what the poet sees is marked first in a long poem.
//
// A line break is ProseMirror's, not a native edit, so Chromium never checks the word before it, nor the text
// a break moves to a new line. checkLinesAfterBreaks has the line the caret is on and the one before it checked
// once the poet has paused after the poem gained or lost a line.
//
// While the observer is stopped ProseMirror would not see the poet's typing, and a delete could take their
// letter instead of the space. So any key, input, composition or click in the editor finishes the check first:
// the space is deleted and the observer started before the poet's input reaches the page. The paragraphs not
// reached are left until the poet edits them.
//
// The delete is tied to the space (Silas, review of #250). It runs only if the editor's DOM is exactly as the
// insert left it and nothing else has focus, with the caret put back after the space. Anything else (a
// transaction rendered meanwhile, an open-file, the find bar taking focus) means the DOM may no longer be
// ProseMirror's, so nothing is deleted and no further paragraph is edited: ProseMirror redraws the editor from
// its state instead, which drops the space wherever it is, and the fixed MISMATCH_LOG is logged. No check starts
// during a composition, and a later whole-poem check does not start once the poem has changed.
//
// The caret is hidden while the check runs (GitHub #107, editor #393). Each paragraph's edit puts the native caret
// after its last word, so the poet saw it run down the end of every line, twice, as a poem opened. It is made
// transparent on the editor element and the editor's own value is put back when the check ends, however it ends.
// The element's attributes are not ProseMirror's document and are not in innerHTML, so nothing above sees the change.
//
// Undo cannot replay the spaces: the native undo stack holds them, but prosemirror-history takes every
// historyUndo/historyRedo beforeinput and prevents its default, so the native one never runs.

export const PAUSE_MS = 30;
export const FIRST_MS = 250;
export const AGAIN_MS = 1500;
// How long the poet has paused, after the poem gained or lost a line, before those lines are checked.
export const BREAK_PAUSE_MS = 500;

// Transaction metadata: prosemirror-history leaves out a transaction with addToHistory false, and tiptap emits
// no update (so Midst records nothing) for one with preventUpdate.
const HISTORY_KEY = 'addToHistory';
const UPDATE_KEY = 'preventUpdate';

export const MISMATCH_LOG =
  'spellcheck: the editor changed while its spelling was being checked';
// Why, appended to MISMATCH_LOG as a reason code: fixed words only, never the poem (editor #238). Annelyse's log held MISMATCH_LOG 5
// times, and nothing in it said which of the two had happened.
export const BECAUSE_POEM_CHANGED = 'poem-changed';
export const BECAUSE_FOCUS_MOVED = 'focus-moved';

// What the poet does that has to wait for the check to finish.
const INPUT_EVENTS: (keyof HTMLElementEventMap)[] = [
  'keydown',
  'beforeinput',
  'compositionstart',
  'mousedown',
];

// ProseMirror's DOM observer is internal; these are the two calls this needs from it.
type Observed = { domObserver: { stop(): void; start(): void } };
/* eslint-disable no-unused-vars -- a type's parameter names, not variables */
type Log = (message: string) => void;
// Told once when a check ends: completed is true only when every paragraph was edited and put back cleanly.
type Done = (completed: boolean) => void;
/* eslint-enable no-unused-vars */
type Spot = { text: Text; at: number };

/** Where a space goes in `paragraph`: just after its last word, in the last text node that has one; or null. */
function afterLastWord(paragraph: Element): Spot | null {
  const walker = paragraph.ownerDocument.createTreeWalker(
    paragraph,
    NodeFilter.SHOW_TEXT
  );
  let spot: Spot | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const at = text.data.trimEnd().length;
    if (at > 0) spot = { text, at };
  }
  return spot;
}

/** The paragraphs that show in the editor first, then the others, each in the poem's order. */
function onScreenFirst(dom: HTMLElement, paragraphs: Element[]): Element[] {
  const box = dom.getBoundingClientRect();
  const shows = (p: Element) => {
    const r = p.getBoundingClientRect();
    return r.bottom > box.top && r.top < box.bottom;
  };
  return [...paragraphs.filter(shows), ...paragraphs.filter((p) => !shows(p))];
}

/** Rebuild the editor's DOM from ProseMirror's state, out of the history and without an update: replacing the
 *  document with an identical copy keeps its nodes, so it is emptied first (measured on #238). */
export function redrawFromState(view: EditorView): void {
  const { state } = view;
  const bookmark = state.selection.getBookmark();
  const { content } = state.doc;
  const quiet = (tr: Transaction) =>
    tr.setMeta(HISTORY_KEY, false).setMeta(UPDATE_KEY, true);
  // Deleting everything leaves the empty paragraph the schema requires.
  view.dispatch(quiet(state.tr.delete(0, state.doc.content.size)));
  const back = view.state.tr.replaceWith(
    0,
    view.state.doc.content.size,
    content
  );
  back.setSelection(bookmark.resolve(back.doc));
  view.dispatch(quiet(back));
}

/**
 * Has Chromium check the spelling of `paragraphs` (the editor's own block elements), one after another, without
 * changing the poem. Returns a function that finishes it at once if it has not finished (the editor is going
 * away), and cancels the recheck a redraw schedules. `log` hears only the fixed MISMATCH_LOG, with a fixed reason.
 * `onDone` is told once when the check ends, however it ends. With `recheck` false, a redraw schedules no recheck.
 */
export function checkParagraphs(
  view: EditorView,
  paragraphs: Element[],
  log: Log,
  onDone: Done = () => {},
  recheck = true
): () => void {
  const { dom } = view;
  const doc = dom.ownerDocument;
  const selection = doc.getSelection();
  const spots = paragraphs
    .map(afterLastWord)
    .filter((spot): spot is Spot => spot !== null);
  // Not in the document, there is no edit Chromium could see; with no words, nothing to check; a composition is the
  // poet's, not to be interrupted; and with the focus elsewhere (the find bar, a marker's name) the first space would
  // go where the focus is, into the poet's field (Silas, review of #448), so no check starts then.
  const focused = doc.activeElement;
  const startable = focused === dom || focused === doc.body || focused === null;
  if (
    !dom.isConnected ||
    !spots.length ||
    !selection ||
    view.composing ||
    !startable
  ) {
    onDone(false);
    return () => {};
  }

  const observer = (view as unknown as Observed).domObserver;
  const kept = Array.from({ length: selection.rangeCount }, (_, i) =>
    selection.getRangeAt(i).cloneRange()
  );
  const before = dom.innerHTML;
  const { caretColor } = dom.style;
  // Moving the caret to each paragraph scrolls it into view; the poet's page is put back (editor #238, case 5).
  const { scrollTop } = dom;

  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // What the latest insert left: the DOM, and the caret just after its space.
  let inserted = '';
  let afterSpace: Range | undefined;
  // Why the DOM is not as it was, once it is not: for the log.
  let because = BECAUSE_POEM_CHANGED;
  // The whole-poem check that follows a redraw, until it is cancelled or ends.
  let recheckTimer: ReturnType<typeof setTimeout> | undefined;
  let finishRecheck = () => {};

  /** Delete the latest space if the DOM is as its insert left it; then whether the DOM is as it was before. */
  const takeSpaceOut = () => {
    const focus = doc.activeElement;
    const focusHere = focus === dom || focus === doc.body || focus === null;
    if (!focusHere) because = BECAUSE_FOCUS_MOVED;
    const untouched =
      afterSpace !== undefined && dom.innerHTML === inserted && focusHere;
    if (untouched && afterSpace) {
      selection.removeAllRanges();
      selection.addRange(afterSpace);
      doc.execCommand('delete', false);
    }
    afterSpace = undefined;
    return dom.innerHTML === before;
  };

  // Called with true only when every paragraph has been reached; as an input listener it gets the poet's event,
  // which ends the check before every paragraph is reached.
  const finish = (how: boolean | Event = false) => {
    if (done) return;
    done = true;
    const completed = how === true;
    clearTimeout(timer);
    INPUT_EVENTS.forEach((type) => dom.removeEventListener(type, finish, true));
    dom.style.caretColor = caretColor;
    if (takeSpaceOut()) {
      selection.removeAllRanges();
      kept.forEach((range) => selection.addRange(range));
      dom.scrollTop = scrollTop;
      observer.start();
      onDone(completed);
      return;
    }
    observer.start();
    redrawFromState(view);
    log(`${MISMATCH_LOG}: ${because}`);
    onDone(false);
    // The redraw built every text node afresh, and Chromium marks a new node only after an edit, so every mark in the
    // poem is gone (measured on #238). Have the whole poem checked again, once: only if the poem is as the redraw left
    // it, and not after a check that was itself a recheck, so a mismatch that keeps happening cannot loop.
    if (!recheck) return;
    const poem = view.state.doc;
    recheckTimer = setTimeout(() => {
      if (view.state.doc === poem && dom.isConnected)
        // eslint-disable-next-line no-use-before-define -- mutual recursion: checkWholePoem is checkParagraphs on every paragraph
        finishRecheck = checkWholePoem(view, log, undefined, false);
    }, FIRST_MS);
  };

  const step = (next: number) => {
    // After a paragraph whose space could not be taken out cleanly, no other is touched: finish redraws.
    if (next > 0 && !takeSpaceOut()) {
      finish(false);
      return;
    }
    const spot = spots[next];
    if (!spot) {
      finish(true);
      return;
    }
    if (!spot.text.isConnected) {
      finish(false);
      return;
    }
    const caret = doc.createRange();
    caret.setStart(spot.text, spot.at);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    doc.execCommand('insertText', false, ' ');
    dom.scrollTop = scrollTop;
    inserted = dom.innerHTML;
    if (selection.rangeCount > 0)
      afterSpace = selection.getRangeAt(0).cloneRange();
    timer = setTimeout(() => step(next + 1), PAUSE_MS);
  };

  observer.stop();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not text for the poet
  dom.style.caretColor = 'transparent';
  INPUT_EVENTS.forEach((type) => dom.addEventListener(type, finish, true));
  step(0);
  // The editor going away: the check ends before every paragraph is reached, and no recheck follows.
  return () => {
    finish(false);
    clearTimeout(recheckTimer);
    finishRecheck();
  };
}

/** checkParagraphs on every paragraph of the poem, those on screen first. */
export default function checkWholePoem(
  view: EditorView,
  log: Log,
  onDone?: Done,
  recheck = true
): () => void {
  return checkParagraphs(
    view,
    onScreenFirst(view.dom, Array.from(view.dom.children)),
    log,
    onDone,
    recheck
  );
}

/** checkWholePoem at FIRST_MS and again at AGAIN_MS, each only while the poem is as it was when this was called
 *  (once it has changed, Chromium has seen an edit). Returns a function that cancels what has not run.
 *
 *  The second never starts over the first (editor #380). On a poem of more than about 40 paragraphs the first is
 *  still running at AGAIN_MS; two at once each find the other's space, so both stopped, redrew the poem and logged,
 *  and the paragraphs after the first ~42 were never checked. So the second waits for the first to finish, and runs
 *  then only if the first reached every paragraph: one ended by the poet's input is not followed by another. */
export function checkWholePoemSoon(view: EditorView, log: Log): () => void {
  const poem = view.state.doc;
  let finishRunning = () => {};
  let running = false;
  let againWaiting = false;
  const start = () => {
    if (view.state.doc !== poem) return;
    running = true;
    finishRunning = checkWholePoem(view, log, (completed) => {
      running = false;
      if (!againWaiting) return;
      againWaiting = false;
      if (completed) start();
    });
  };
  const first = setTimeout(start, FIRST_MS);
  const again = setTimeout(() => {
    if (running) againWaiting = true;
    else start();
  }, AGAIN_MS);
  return () => {
    clearTimeout(first);
    clearTimeout(again);
    finishRunning();
  };
}

/**
 * For a line break (editor #238, cases 2 to 4): `changed` is to be called on every change of the poem. Once the
 * poem has gained or lost a line, and then BREAK_PAUSE_MS pass with no change, the line the caret is on and the
 * one before it are checked. `cancel` stops what has not run and finishes a running check.
 */
export function checkLinesAfterBreaks(
  view: EditorView,
  log: Log
): { changed: () => void; cancel: () => void } {
  let lines = view.state.doc.childCount;
  let due = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finishRunning = () => {};
  const changed = () => {
    const now = view.state.doc.childCount;
    if (now !== lines) {
      lines = now;
      due = true;
    }
    if (!due) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      due = false;
      const at = view.state.selection.$head.index(0);
      const paragraphs = [at - 1, at]
        .map((i) => view.dom.children[i])
        .filter((p): p is Element => p !== undefined);
      finishRunning = checkParagraphs(view, paragraphs, log);
    }, BREAK_PAUSE_MS);
  };
  return {
    changed,
    cancel: () => {
      clearTimeout(timer);
      finishRunning();
    },
  };
}
