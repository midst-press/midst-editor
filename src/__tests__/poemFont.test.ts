import { readFileSync } from 'fs';
import path from 'path';
import {
  APP_FONT_STACK,
  cssFontName,
  fontFamilyOf,
  poemFontStack,
  withFontFamily,
} from '../renderer/poemFont/poemFont';

// The poem's font in `meta.fontFamily` (#240). Synthetic values only.

describe('fontFamilyOf', () => {
  it('is the stored name, kept as it is', () => {
    expect(fontFamilyOf({ fontFamily: 'Zqfont Book' })).toBe('Zqfont Book');
    expect(fontFamilyOf({ fontFamily: ' padded ' })).toBe(' padded ');
  });

  it('is null when the poem has no usable font of its own', () => {
    expect(fontFamilyOf({})).toBeNull();
    expect(fontFamilyOf({ fontFamily: '' })).toBeNull();
    expect(fontFamilyOf({ fontFamily: '   ' })).toBeNull();
    expect(fontFamilyOf({ fontFamily: 12 })).toBeNull();
    expect(fontFamilyOf({ fontFamily: null })).toBeNull();
  });
});

describe('withFontFamily', () => {
  it('sets the font and keeps every other key, without changing what it was given', () => {
    const meta = {
      draftMarkers: [{ index: 0 }],
      unknownKey: 'kept',
      fontFamily: 'Old',
    };
    const result = withFontFamily(meta, 'Zqfont');
    expect(result).toEqual({
      ok: true,
      meta: {
        draftMarkers: [{ index: 0 }],
        unknownKey: 'kept',
        fontFamily: 'Zqfont',
      },
    });
    expect(meta.fontFamily).toBe('Old');
  });

  it("removes the font for the app's own, and keeps the rest", () => {
    const meta = { fontFamily: 'Zqfont', unknownKey: 'kept' };
    expect(withFontFamily(meta, null)).toEqual({
      ok: true,
      meta: { unknownKey: 'kept' },
    });
    expect(meta).toEqual({ fontFamily: 'Zqfont', unknownKey: 'kept' });
  });
});

describe('cssFontName', () => {
  it('quotes a plain name', () => {
    expect(cssFontName('Zqfont Book')).toBe('"Zqfont Book"');
  });

  it('escapes what would end or break the CSS string', () => {
    expect(cssFontName('a"b')).toBe('"a\\"b"');
    expect(cssFontName('a\\b')).toBe('"a\\\\b"');
    expect(cssFontName('a\nb\u007fc')).toBe('"a\\a b\\7f c"');
  });

  it('keeps letters outside ASCII as they are', () => {
    expect(cssFontName('ヒラギノ角ゴ')).toBe('"ヒラギノ角ゴ"');
  });
});

describe('poemFontStack', () => {
  it("is the app's own font when the poem has none", () => {
    expect(poemFontStack(null)).toBe(APP_FONT_STACK);
  });

  it("puts the poem's font first and falls back to the app's", () => {
    expect(poemFontStack('Zqfont')).toBe(`"Zqfont", ${APP_FONT_STACK}`);
  });
});

// Editor.css and Replay.css spell the same fallback for `--poem-font` as APP_FONT_STACK, so a poem with
// no font of its own looks the same whether or not the variable is set.
describe('the CSS fallback', () => {
  const fallbackOf = (file: string) => {
    const css = readFileSync(
      path.join(__dirname, '..', 'renderer', 'components', file),
      'utf8'
    );
    const found = css.match(/var\(\s*--poem-font,([^)]*)\)/);
    if (!found) throw new Error(`${file} has no --poem-font fallback`);
    return found[1].split(',').map((name) => name.trim());
  };
  const expected = APP_FONT_STACK.split(',').map((name) => name.trim());

  it.each(['Editor/Editor.css', 'Replay/Replay.css'])(
    '%s matches APP_FONT_STACK',
    (file) => {
      expect(fallbackOf(file)).toEqual(expected);
    }
  );
});
