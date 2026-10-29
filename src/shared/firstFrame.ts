import {
  ChangeObj,
  compareStrings,
  step,
} from '@midst-press/midst-format/history';

// A new poem's Timeline begins at an empty page (GitHub #29). Its first change records nothing, and its time is
// when the poem was made. Only new poems get it; opened and converted poems keep the history they have.
export const emptyFirstFrame = (t: Date = new Date()): ChangeObj =>
  compareStrings('', '', 0, t);

// Whether the poem's first frame is an empty page, which is not a change the poet made.
export const startsEmpty = (history: ChangeObj[]): boolean =>
  history.length > 0 && step('', history[0]) === '';

// The changes the poet made: the history, less an empty first frame.
export const changesMade = (history: ChangeObj[]): number =>
  history.length - (startsEmpty(history) ? 1 : 0);
