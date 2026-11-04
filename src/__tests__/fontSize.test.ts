/** @jest-environment node */
import {
  FONT_SIZES,
  fontSizeAbove,
  fontSizeBelow,
  lastUsedFontSize,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  nearestFontSize,
  NEW_POEM_FONT_SIZE,
  newPoemMeta,
  shownFontSize,
  UNSIZED_POEM_FONT_SIZE,
} from '../main/fontSize';

// GitHub #105, editor #390: the earlier steps (10, 12, 16, 24, 32) with each jump halved, up to 36.
describe('the steps', () => {
  it('are the earlier ones with each jump halved, up to 36', () => {
    expect(FONT_SIZES).toEqual([10, 11, 12, 14, 16, 20, 24, 28, 32, 36]);
    expect([MIN_FONT_SIZE, MAX_FONT_SIZE]).toEqual([10, 36]);
  });

  // Violet, 4 Nov: by poem, not by poet. A new poem starts at 14; an existing one without a size of its
  // own stays at 16, where it has always been shown.
  it('start a new poem at 14, and show an existing unsized one at 16', () => {
    expect([NEW_POEM_FONT_SIZE, UNSIZED_POEM_FONT_SIZE]).toEqual([14, 16]);
  });

  it('hold every size the original editor wrote (midst-format META.md)', () => {
    [10, 12, 14, 24, 36].forEach((size) => expect(FONT_SIZES).toContain(size));
  });
});

describe('fontSizeAbove and fontSizeBelow', () => {
  it('step one size at a time, and stop at the ends', () => {
    expect(fontSizeAbove(14)).toBe(16);
    expect(fontSizeBelow(14)).toBe(12);
    expect(fontSizeAbove(36)).toBeNull();
    expect(fontSizeBelow(10)).toBeNull();
  });

  it('step from a size the steps do not hold to the next one each way', () => {
    expect(fontSizeAbove(13)).toBe(14);
    expect(fontSizeBelow(13)).toBe(12);
    expect(fontSizeBelow(50)).toBe(36);
    expect(fontSizeAbove(50)).toBeNull();
    expect(fontSizeAbove(4)).toBe(10);
    expect(fontSizeBelow(4)).toBeNull();
  });
});

describe('nearestFontSize', () => {
  it('is the closest step, the smaller of two equally close', () => {
    expect(nearestFontSize(14)).toBe(14);
    expect(nearestFontSize(15)).toBe(14);
    expect(nearestFontSize(17)).toBe(16);
    expect(nearestFontSize(100)).toBe(36);
    expect(nearestFontSize(1)).toBe(10);
  });
});

describe('shownFontSize', () => {
  it('draws a size at itself inside the range, and at the nearest end outside it', () => {
    expect(shownFontSize(13)).toBe(13);
    expect(shownFontSize(50)).toBe(36);
    expect(shownFontSize(4)).toBe(10);
  });
});

describe('lastUsedFontSize', () => {
  it('is null when nothing is stored, or what is stored cannot be read', () => {
    [undefined, null, '', 'zq', '-5', 'Infinity'].forEach((stored) =>
      expect(lastUsedFontSize(stored)).toBeNull()
    );
  });

  it('keeps the size a poet had before #390, stored as a step 0 to 4', () => {
    expect(['0', '1', '2', '3', '4'].map(lastUsedFontSize)).toEqual([
      10, 12, 16, 24, 32,
    ]);
    expect(lastUsedFontSize(0)).toBe(10);
  });

  it('reads a size as itself if it is a step, else as the nearest step', () => {
    expect(lastUsedFontSize('20')).toBe(20);
    expect(lastUsedFontSize('36')).toBe(36);
    expect(lastUsedFontSize('15')).toBe(14);
    expect(lastUsedFontSize('5.5')).toBe(10);
  });
});

describe('newPoemMeta', () => {
  it('starts a new poem at the last size used, written into its meta', () => {
    expect(JSON.parse(newPoemMeta('20'))).toEqual({ fontSize: 20 });
    expect(JSON.parse(newPoemMeta('2'))).toEqual({ fontSize: 16 });
  });

  it('starts it at 14 when no size has been used', () => {
    [undefined, '', 'zq'].forEach((stored) =>
      expect(JSON.parse(newPoemMeta(stored))).toEqual({ fontSize: 14 })
    );
  });
});
