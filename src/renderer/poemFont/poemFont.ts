// A poem's font (#240; Annelyse, GitHub #73): one font for the whole poem, any font installed on the
// poet's computer, kept in the file as `meta.fontFamily` (midst-format docs/META.md).
//
// A poem with no `meta.fontFamily` is shown in the app's own font, as every poem was before this
// change. Only a font the poet chooses is written into the file.
//
// These functions never change the object they are given, and they keep every other key of `meta`.
import { Meta } from '../tracking/draftMarkers';

// The app's own font: Editor.css and Replay.css use the same list as the fallback of `--poem-font`
// (poemFont.test.ts checks that they agree).
/* eslint-disable lingui/no-unlocalized-strings -- font names, not text for the poet */
export const APP_FONT_STACK = [
  'system-ui',
  '-apple-system',
  'BlinkMacSystemFont',
  "'Segoe UI'",
  'Roboto',
  'Oxygen',
  'Ubuntu',
  'Cantarell',
  "'Open Sans'",
  "'Helvetica Neue'",
  'sans-serif',
].join(', ');
/* eslint-enable lingui/no-unlocalized-strings */

export type FontResult = { ok: true; meta: Meta };

// The poem's chosen font, or null when it has none (or what is stored is not a usable name). A value
// this app does not have installed is still returned: the file keeps it, and a save writes it back.
export const fontFamilyOf = (meta: Meta): string | null => {
  const family = meta.fontFamily;
  return typeof family === 'string' && family.trim() !== '' ? family : null;
};

// `meta` with the poem's font set to `family`, or with no font of its own when `family` is null.
export const withFontFamily = (
  meta: Meta,
  family: string | null
): FontResult => {
  const next: Meta = { ...meta };
  if (family === null) delete next.fontFamily;
  else next.fontFamily = family;
  return { ok: true, meta: next };
};

// A family name as a CSS string. A name can hold a quote or a backslash, and it comes from the file,
// so it is never pasted into CSS as it is. Control characters cannot appear in a CSS string, so they
// are escaped as code points.
export const cssFontName = (family: string): string =>
  `"${Array.from(family)
    .map((ch) => {
      if (ch === '"' || ch === '\\') return `\\${ch}`;
      const code = ch.codePointAt(0) as number; // a character always has one
      return code < 0x20 || code === 0x7f ? `\\${code.toString(16)} ` : ch;
    })
    .join('')}"`;

// The value of `--poem-font`: the poem's font first, then the app's own, so a font that is not
// installed here, or has no glyph for a character, falls back to the app's.
export const poemFontStack = (family: string | null): string =>
  family === null
    ? APP_FONT_STACK
    : `${cssFontName(family)}, ${APP_FONT_STACK}`;
