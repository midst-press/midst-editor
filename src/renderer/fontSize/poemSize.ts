// A poem's text size (editor #390; Annelyse, GitHub #105): one size for the whole poem, kept in the file
// as `meta.fontSize`, a number of CSS px (midst-format docs/META.md). Like the font, it is not a step in
// the Timeline.
//
// These functions never change the object they are given, and they keep every other key of `meta`.
import { Meta } from '../tracking/draftMarkers';

export type SizeResult = { ok: true; meta: Meta };

// The poem's own size, or null when it has none, or what is stored is not a positive number. A size the
// steps do not hold is still returned: the file keeps it, and a save writes it back.
export const fontSizeOf = (meta: Meta): number | null => {
  const size = meta.fontSize;
  return typeof size === 'number' && Number.isFinite(size) && size > 0
    ? size
    : null;
};

// `meta` with the poem's size set to `px`.
export const withFontSize = (meta: Meta, px: number): SizeResult => ({
  ok: true,
  meta: { ...meta, fontSize: px },
});
