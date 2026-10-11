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
// work that did not exist. The default gives a new profile the value a returning one has. Anything
// else that is not 'false' still warns, which is the safe direction for a value nobody expected.
const store = new Store<Record<string, unknown>>({
  defaults: { edited: 'false' },
});
export default store;
