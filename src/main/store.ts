import Store from 'electron-store';

// const schema = {
//   filename: {
//     type: string,
//     default: '',
//   },
//  baseFilename: {
//     type: string,
//     default: '',
//   },
//   poem: {
//     type: string,
//     default: '',
//   },
//   history: {
//     type: string,
//     default: '[]',
//   },
//   edited: {
//     type: string,
//     default: 'false',
//   },
//   font-size: {
//     type: string,
//     default: '2',
//   },
//   spellcheck: {
//     type: string,
//     default: 'false',
//   },
// };

// `edited` is read as "no unsaved changes" only when it is the string 'false' (menu.ts
// handleUnsavedChanges, and the window's close handler in main.ts). A new profile has no value at
// all, which read as "unsaved changes": the first open, and closing the empty window, warned about
// work that did not exist. So a profile with no `edited` is given 'false', the value a returning one
// has, but ONLY when it holds no work. Builds from before `edited` existed (upstream, April to August
// 2023) stored a poem and its history without it; such a profile keeps no value, and still warns before
// an open replaces its poem (#10). Anything else that is not 'false' still warns, which is the safe
// direction for a value nobody expected.
/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
type StoreLike = {
  has: (key: string) => boolean;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
};
/* eslint-enable no-unused-vars */
const holdsWork = (s: StoreLike): boolean => {
  const poem = s.get('poem');
  const history = s.get('history');
  return (
    (typeof poem === 'string' && poem !== '') ||
    (typeof history === 'string' && history !== '' && history !== '[]')
  );
};
export const settleEdited = (s: StoreLike): void => {
  if (!s.has('edited') && !holdsWork(s)) s.set('edited', 'false');
};

const store = new Store<Record<string, unknown>>();
settleEdited(store);
export default store;
