// The one rule for reading the stored font size, shared by the main process and the renderer.
// No imports, so the renderer can bundle it.
//
// The size is stored as a string. Only a missing or empty value is unset: 0 is the smallest size,
// whichever type it was stored as. A value that is not a number comes back NaN, which every caller
// already rejects when it checks the result against the sizes it supports.

export const DEFAULT_FONT_SIZE = 2;

export const fontSizeFromStore = (stored: unknown): number =>
  stored === undefined || stored === null || stored === ''
    ? DEFAULT_FONT_SIZE
    : Number(stored);

// The sizes there are classes for: size-0 to size-4.
export const MIN_FONT_SIZE = 0;
export const MAX_FONT_SIZE = 4;

// The stored size if it is one of those, else the default.
export const fontSizeOrDefault = (stored: unknown): number => {
  const size = fontSizeFromStore(stored);
  return Number.isInteger(size) &&
    size >= MIN_FONT_SIZE &&
    size <= MAX_FONT_SIZE
    ? size
    : DEFAULT_FONT_SIZE;
};
