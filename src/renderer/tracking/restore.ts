import { ChangeObj, compareStrings, reconstruct } from './utils';

// Restoring the text from an earlier point in a poem's history (GitHub #18). Non-destructive: the restore
// is one new change at the END of the history, turning the current text into the chosen frame's text.
// Every earlier change stays, so the timeline still plays everything the poet wrote, the restore included,
// and a draft marker (an index into the history) still points at the same moment.
//
// Kept out of utils.ts on purpose: midst-web holds a byte-for-byte copy of that file.

// Why a restore was refused. Fixed messages: they may be logged, and must never quote the poem.
export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreError';
  }
}

const textAt = (history: ChangeObj[], index: number) =>
  reconstruct('', history, index);

function checkIndex(history: ChangeObj[], index: number) {
  if (!Array.isArray(history) || history.length === 0)
    throw new RestoreError('there is no history to restore from');
  if (!Number.isSafeInteger(index) || index < 0 || index >= history.length)
    throw new RestoreError('the frame to restore is not in the history');
}

// Whether restoring frame `index` would change the current text. False when that frame's text is the
// text as it stands, which includes the last frame itself.
export function wouldChange(history: ChangeObj[], index: number): boolean {
  checkIndex(history, index);
  return textAt(history, index) !== textAt(history, history.length - 1);
}

// The history with the restore appended. The input is never modified. The result is checked before it is
// returned: if replaying it does not end in the chosen frame's text, nothing is returned at all.
//
// `pos` is supplied by the caller, as it is for every edit (compareStrings never computes it): the
// editor's ProseMirror cursor position in the document AFTER the change (Editor's onUpdate passes
// selection.$anchor.pos). It is not an offset into the HTML string, so it cannot be derived from the
// change here; the caller, which holds the editor, works it out.
export function restoreFrame(
  history: ChangeObj[],
  index: number,
  pos: number,
  t: Date = new Date()
): ChangeObj[] {
  checkIndex(history, index);
  if (!Number.isSafeInteger(pos) || pos < 0)
    throw new RestoreError('the cursor position is not a document position');
  const target = textAt(history, index);
  const current = textAt(history, history.length - 1);
  const restored = [...history, compareStrings(current, target, pos, t)];
  if (textAt(restored, restored.length - 1) !== target)
    throw new RestoreError(
      'the restored history does not replay to the chosen frame'
    );
  return restored;
}
