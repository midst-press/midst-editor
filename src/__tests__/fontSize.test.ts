/** @jest-environment node */
import {
  DEFAULT_FONT_SIZE,
  fontSizeFromStore,
  fontSizeOrDefault,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from '../main/fontSize';

describe('fontSizeFromStore', () => {
  it('reads a missing, null or empty value as unset', () => {
    expect(DEFAULT_FONT_SIZE).toBe(2);
    expect(fontSizeFromStore(undefined)).toBe(2);
    expect(fontSizeFromStore(null)).toBe(2);
    expect(fontSizeFromStore('')).toBe(2);
  });

  it('reads the sizes as stored, whether string or number', () => {
    ['0', '1', '2', '3', '4'].forEach((stored, size) => {
      expect(fontSizeFromStore(stored)).toBe(size);
      expect(fontSizeFromStore(size)).toBe(size);
    });
  });

  it('reads 0 as the smallest size, not as unset', () => {
    expect(fontSizeFromStore(0)).toBe(0);
    expect(fontSizeFromStore('0')).toBe(0);
  });

  it('gives NaN for a value that is not a size, for the caller to reject', () => {
    expect(fontSizeFromStore('zq')).toBeNaN();
  });
});

describe('fontSizeOrDefault', () => {
  it('keeps every size there is a class for, stored as a string or a number', () => {
    expect([MIN_FONT_SIZE, MAX_FONT_SIZE]).toEqual([0, 4]);
    ['0', '1', '2', '3', '4', 0, 4].forEach((stored) =>
      expect(fontSizeOrDefault(stored)).toBe(Number(stored))
    );
  });

  it.each([[undefined], [''], ['5'], ['-1'], ['2.5'], ['abc'], [9]])(
    'reads %p as the default',
    (stored) => {
      expect(fontSizeOrDefault(stored)).toBe(DEFAULT_FONT_SIZE);
    }
  );
});
