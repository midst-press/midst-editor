// What the development renderer DLL prebuilds: every dependency, less those it cannot or should not take.
// - TipTap stays out of the DLL (it was excluded before this file existed).
// - @midst-press/midst-format is the vendored format library (midst-format #50). It has subpath exports
//   only, no '.', so as a DLL entry it does not resolve and the whole DLL build fails, which failed a plain
//   `npm ci` (#204). Its subpaths are bundled from source like any app import.
const NOT_IN_DLL = ['@midst-press/midst-format'];

const dllEntries = (dependencies: Record<string, string> = {}): string[] =>
  Object.keys(dependencies).filter(
    (it) => !it.includes('tiptap') && !NOT_IN_DLL.includes(it)
  );

export default dllEntries;
