import { ChangeObj, compareStrings, reconstruct } from './utils';

// Restarting from an earlier point in a poem's history (GitHub #18): the poet carries on writing from the text
// as it stood at a chosen frame. Non-destructive: the restart
// is one new change at the END of the history, turning the current text into the chosen frame's text.
// Every earlier change stays, so the timeline still plays everything the poet wrote, the restart included,
// and a draft marker (an index into the history) still points at the same moment.
//
// Kept out of utils.ts on purpose: midst-web holds a byte-for-byte copy of that file.

// Why a restart was refused. Fixed messages: they may be logged, and must never quote the poem.
export class RestartFromError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestartFromError';
  }
}

const textAt = (history: ChangeObj[], index: number) =>
  reconstruct('', history, index);

function checkIndex(history: ChangeObj[], index: number) {
  if (!Array.isArray(history) || history.length === 0)
    throw new RestartFromError('there is no history to restart from');
  if (!Number.isSafeInteger(index) || index < 0 || index >= history.length)
    throw new RestartFromError(
      'the frame to restart from is not in the history'
    );
}

// Whether restarting from frame `index` would change the current text. False when that frame's text is the
// text as it stands, which includes the last frame itself.
export function wouldChange(history: ChangeObj[], index: number): boolean {
  checkIndex(history, index);
  return textAt(history, index) !== textAt(history, history.length - 1);
}

// The history with the restart appended. The input is never modified. The result is checked before it is
// returned: if replaying it does not end in the chosen frame's text, nothing is returned at all.
//
// `pos` is supplied by the caller, as it is for every edit (compareStrings never computes it): the
// editor's ProseMirror cursor position in the document AFTER the change (Editor's onUpdate passes
// selection.$anchor.pos). It is not an offset into the HTML string, so it cannot be derived from the
// change here; the caller, which holds the editor, works it out.
export function restartFrom(
  history: ChangeObj[],
  index: number,
  pos: number,
  t: Date = new Date()
): ChangeObj[] {
  checkIndex(history, index);
  if (!Number.isSafeInteger(pos) || pos < 0)
    throw new RestartFromError(
      'the cursor position is not a document position'
    );
  const target = textAt(history, index);
  const current = textAt(history, history.length - 1);
  const next = [...history, compareStrings(current, target, pos, t)];
  if (textAt(next, next.length - 1) !== target)
    throw new RestartFromError(
      'the new history does not replay to the chosen frame'
    );
  return next;
}
