import { createContext } from 'react';
import { ChangeObj } from 'renderer/tracking/utils';

const initialTextState = {
  text: '',
  setText: (text: string) => {},
};

const initialHistoryState = {
  poemHistory: [] as ChangeObj[],
  setPoemHistory: (poemHistory: ChangeObj[]) => {},
};
const initialFilenameState = {
  text: '',
  setText: (filename: string) => {},
};

export const TextContext = createContext(initialTextState);
export const HistoryContext = createContext(initialHistoryState);
export const FilenameContext = createContext(initialFilenameState);
