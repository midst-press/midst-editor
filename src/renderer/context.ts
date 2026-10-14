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

// Where the app starts after it reloads its own window (the spellcheck toggle does). Held in the
// window's session storage, so it is gone when the app is quit: a fresh start shows the opening screen.
export const RETURN_TO = 'midst-return-to';

export const TextContext = createContext(initialTextState);
export const HistoryContext = createContext(initialHistoryState);
export const FilenameContext = createContext(initialFilenameState);
