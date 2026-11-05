import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  APP_FONT_STACK,
  BUNDLED_FONTS,
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

// The fonts that come with the app (editor #445; Annelyse, GitHub #73): Jost is the app's own font, and every font
// the app offers as its own has a face in fonts.css, in both styles, from a file that is there.
describe('the fonts that come with the app', () => {
  const fontsDir = path.join(__dirname, '..', 'renderer', 'fonts');
  const css = readFileSync(path.join(fontsDir, 'fonts.css'), 'utf8');
  const faces = Array.from(css.matchAll(/@font-face\s*{([^}]*)}/g)).map(
    ([, body]) => ({
      family: (body.match(/font-family:\s*([^;]+);/)?.[1] ?? '')
        .trim()
        .replace(/^'(.*)'$/, '$1'),
      style: body.match(/font-style:\s*([^;]+);/)?.[1].trim(),
      urls: Array.from(body.matchAll(/url\('([^']+)'\)/g)).map(([, u]) => u),
      local: /local\(/.test(body),
    })
  );

  it("the app's own font is Jost first, then the system's", () => {
    expect(APP_FONT_STACK.split(',')[0].trim()).toBe('Jost');
    expect(APP_FONT_STACK).toContain('system-ui');
  });

  it.each(['Jost', ...BUNDLED_FONTS])(
    '%s has a normal and an italic face, each from a bundled file that exists',
    (family) => {
      const mine = faces.filter((face) => face.family === family);
      expect(mine.map((face) => face.style).sort()).toEqual([
        'italic',
        'normal',
      ]);
      mine.forEach((face) => {
        expect(face.local).toBe(false);
        expect(face.urls).toHaveLength(1);
        expect(existsSync(path.join(fontsDir, face.urls[0]))).toBe(true);
      });
    }
  );

  it('the package carries the licences: the fonts go into the renderer bundle, their OFL.txt into Resources', () => {
    const { build } = JSON.parse(
      readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
    ) as { build: { extraResources: unknown[] } };
    expect(build.extraResources).toContainEqual({
      from: 'src/renderer/fonts',
      to: 'fonts',
      filter: ['**/OFL.txt', 'README.md'],
    });
  });

  it('each bundled family keeps its licence beside it', () => {
    faces.forEach((face) => {
      const dir = path.dirname(path.join(fontsDir, face.urls[0]));
      expect(readFileSync(path.join(dir, 'OFL.txt'), 'utf8')).toContain(
        'SIL OPEN FONT LICENSE'
      );
    });
  });
});
