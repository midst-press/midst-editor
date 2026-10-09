import { createContext } from 'react';
import { ChangeObj } from 'renderer/tracking/utils';

const initialTextState = {
  text: '',
  // Default no-op setter; real setter is supplied by the Provider in App.tsx.
  setText: (text: string) => {
    if (text) {
      /* no-op */
    }
  },
};

const initialHistoryState = {
  poemHistory: [] as ChangeObj[],
  // Default no-op setter; real setter is supplied by the Provider in App.tsx.
  setPoemHistory: (poemHistory: ChangeObj[]) => {
    if (poemHistory) {
      /* no-op */
    }
  },
};
const initialFilenameState = {
  text: '',
  // Default no-op setter; real setter is supplied by a Provider.
  setText: (filename: string) => {
    if (filename) {
      /* no-op */
    }
  },
};

export const TextContext = createContext(initialTextState);
export const HistoryContext = createContext(initialHistoryState);
export const FilenameContext = createContext(initialFilenameState);
