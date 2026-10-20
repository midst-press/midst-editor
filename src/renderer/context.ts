import { createContext } from 'react';
import { ChangeObj } from '@midst-press/midst-format/history';

// The defaults carry each context's type. App.tsx provides the real setters; a consumer rendered without its
// Provider would otherwise drop the poem's text or history without a word, so the defaults throw (#253).
// eslint-disable-next-line no-unused-vars -- the base rule reports a parameter named in a function type
const initialTextState: { text: string; setText: (text: string) => void } = {
  text: '',
  setText: () => {
    throw new Error('TextContext used outside its Provider');
  },
};

const initialHistoryState: {
  poemHistory: ChangeObj[];
  // eslint-disable-next-line no-unused-vars -- the base rule reports a parameter named in a function type
  setPoemHistory: (poemHistory: ChangeObj[]) => void;
} = {
  poemHistory: [],
  setPoemHistory: () => {
    throw new Error('HistoryContext used outside its Provider');
  },
};

// Where the app starts after it reloads its own window (the spellcheck toggle does). Held in the
// window's session storage, so it is gone when the app is quit: a fresh start shows the opening screen.
export const RETURN_TO = 'midst-return-to';

export const TextContext = createContext(initialTextState);
export const HistoryContext = createContext(initialHistoryState);
