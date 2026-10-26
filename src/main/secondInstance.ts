// The poem a second launch of Midst was asked to open, from its command line: how Windows and Linux hand a
// double-clicked file to the app. On macOS a poem arrives through the app's open-file event instead. The last
// argument that is not a switch and names a .midst file, or '' when there is none.
const poemIn = (argv: readonly string[]): string =>
  [...argv]
    .reverse()
    .find((arg) => !arg.startsWith('-') && /\.midst$/i.test(arg)) ?? '';

export default poemIn;
