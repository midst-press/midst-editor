// The text sizes, and the one rule for reading the last size the poet used. Shared by the main process
// and the renderer, so no imports: the renderer bundles it.
//
// Sizes are CSS px, the unit midst-format's META.md gives `meta.fontSize` (GitHub #105, editor #390:
// "pt" in the poet's words). The steps are the earlier ones (10, 12, 16, 24, 32) with every jump halved,
// up to 36 (Annelyse, 4 Nov: twice the granularity, 36 the largest). They hold every size the original
// editor wrote (10, 12, 14, 24, 36), so a converted poem opens at its own size.
export const FONT_SIZES: readonly number[] = [
  10, 11, 12, 14, 16, 20, 24, 28, 32, 36,
];
export const MIN_FONT_SIZE = FONT_SIZES[0];
export const MAX_FONT_SIZE = FONT_SIZES[FONT_SIZES.length - 1];

// The size before the poet has used any: META.md's default for `fontSize`.
export const DEFAULT_FONT_SIZE = 14;

// Before #390 the store held a step, 0 to 4, of these sizes. A poet's last size is kept across the change.
const STEPS_BEFORE_390 = [10, 12, 16, 24, 32];

const isSize = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

// The size closest to `px` that the steps hold; the smaller of two equally close.
export const nearestFontSize = (px: number): number =>
  FONT_SIZES.reduce((best, size) =>
    Math.abs(size - px) < Math.abs(best - px) ? size : best
  );

// The last size the poet used, from the store's 'font-size' (a string). Unset or unreadable gives the
// default; a step stored before #390 gives its size; any other size gives the nearest step.
export const lastUsedFontSize = (stored: unknown): number => {
  if (stored === undefined || stored === null || stored === '')
    return DEFAULT_FONT_SIZE;
  const n = Number(stored);
  if (Number.isInteger(n) && n >= 0 && n < STEPS_BEFORE_390.length)
    return STEPS_BEFORE_390[n];
  return isSize(n) ? nearestFontSize(n) : DEFAULT_FONT_SIZE;
};

// The size a poem is drawn at. A poem keeps whatever size its file holds, and a save writes it back
// (META.md); it is drawn at that size within the steps' range, and at the nearest end outside it.
export const shownFontSize = (px: number): number =>
  Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, px));

// The next step up from `px`, or null at the largest. `px` need not be a step: 13 goes up to 14.
export const fontSizeAbove = (px: number): number | null =>
  FONT_SIZES.find((size) => size > px) ?? null;

// The next step down from `px`, or null at the smallest. 13 goes down to 12, and 50 to 36.
export const fontSizeBelow = (px: number): number | null =>
  [...FONT_SIZES].reverse().find((size) => size < px) ?? null;
