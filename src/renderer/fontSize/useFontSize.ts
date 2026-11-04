import { PoemSize, usePoemSize } from './PoemSizeContext';

// The open poem's text size, for the screens that show it and their size buttons (editor #390). The
// state lives in PoemSizeContext, so the editor, Replay and the View menu all step the same size.
export default function useFontSize(): PoemSize {
  return usePoemSize();
}

export type FontSize = PoemSize;
