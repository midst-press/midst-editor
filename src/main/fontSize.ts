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
