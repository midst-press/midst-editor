// The poem a second launch of Midst was asked to open, from its command line: how Windows and Linux hand a
// double-clicked file to the app. On macOS a poem arrives through the app's open-file event instead. The last
// argument that is not a switch and names a .midst file, or '' when there is none.
const poemIn = (argv: readonly string[]): string =>
  [...argv]
    .reverse()
    .find((arg) => !arg.startsWith('-') && /\.midst$/i.test(arg)) ?? '';

// The poem a second launch sends with its lock request (requestSingleInstanceLock's additionalData), or ''. Electron
// documents that argv can reach the running copy reordered or with switches added on Windows and Linux; the second
// launch's own argv, read there and sent as data, does not depend on that.
export const poemFromData = (data: unknown): string => {
  const poem = (data as { poem?: unknown } | null)?.poem;
  return typeof poem === 'string' && /\.midst$/i.test(poem) ? poem : '';
};

export default poemIn;
