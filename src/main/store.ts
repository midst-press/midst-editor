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

const store = new Store();
export default store;
