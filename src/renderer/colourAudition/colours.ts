/* eslint-disable lingui/no-unlocalized-strings -- an audition tool for Annelyse (GitHub #119), in English only and
   never in a release; see README.md in this folder */
import { ThemeOptions } from '@mui/material';
import { CSS_VARS, CssVarKey } from '../cssVars';

// The colours Annelyse can audition (GitHub #119), light and dark separately. Each is a CSS variable from
// cssVars.ts, an entry in the MUI palette, or both: where cssVars.ts takes a variable `from` the theme, the one
// choice sets both, so the two cannot disagree. The palette-only entries are colours MUI draws with that have
// no variable of their own.

export type Scheme = 'light' | 'dark';
export const SCHEMES: Scheme[] = ['light', 'dark'];

type PalettePath =
  | 'background.default'
  | 'background.paper'
  | 'primary.main'
  | 'primary.dark'
  | 'secondary.main'
  | 'secondary.contrastText'
  | 'action.selected'
  | 'action.hover'
  | 'error.light'
  | 'text.primary';

export interface AuditionColour {
  id: string;
  label: string;
  group: string;
  css?: CssVarKey;
  palette?: PalettePath;
}

// Named for what Annelyse sees, not MUI's terms: MUI's "primary" is a pink, and the beige is the background.
const PRIMARY = 'Background (the beige)';
const SECONDARY = 'Pinks (primary and secondary)';
const TEXT = 'Text';
const LINES = 'Dividers and lines';
const SWITCHES = 'Switches and sliders';
const ICONS = 'Icons and buttons';
const SURFACES = 'Cards, menus and tooltips';
const FIND = 'Find and search';
const MUI = 'Selection and hover';

const css = (key: CssVarKey, label: string, group: string): AuditionColour => ({
  id: key,
  label,
  group,
  css: key,
});

export const AUDITION_COLOURS: AuditionColour[] = [
  {
    ...css('background', 'Background', PRIMARY),
    palette: 'background.default',
  },
  { ...css('primary', 'Primary', SECONDARY), palette: 'primary.main' },
  {
    ...css('primaryDark', 'Primary, darker', SECONDARY),
    palette: 'primary.dark',
  },
  {
    id: 'secondary',
    label: 'Secondary',
    group: SECONDARY,
    palette: 'secondary.main',
  },
  {
    id: 'onSecondary',
    label: 'Text on secondary',
    group: SECONDARY,
    palette: 'secondary.contrastText',
  },
  css('controlBar', 'Replay control bar', SECONDARY),
  css('onControlBar', 'Icons on the control bar', SECONDARY),
  css('controlBarHover', 'Control bar hover', SECONDARY),
  css('logo', 'Logo', SECONDARY),
  { ...css('textPrimary', 'Text', TEXT), palette: 'text.primary' },
  css('mutedText', 'Window title and editor icons', TEXT),
  css('link', 'Link', TEXT),
  { ...css('errorLight', 'Problem', TEXT), palette: 'error.light' },
  css('divider', 'Settings divider', LINES),
  css('titleRule', 'Line under a title', LINES),
  css('scrollbarThumb', 'Scrollbar', LINES),
  css('switchOn', 'Switch, on', SWITCHES),
  css('switchOff', 'Switch, off', SWITCHES),
  css('switchThumb', 'Switch knob', SWITCHES),
  css('activeIcon', 'Active icon', ICONS),
  css('buttonBackground', 'Opening screen button', ICONS),
  css('buttonHover', 'Opening screen button, hover', ICONS),
  css('buttonText', 'Opening screen button text', ICONS),
  css('card', 'Welcome card', SURFACES),
  css('onCard', 'Text on the welcome card', SURFACES),
  css('surface', 'Menus and slider label', SURFACES),
  css('tooltipText', 'Tooltip text', SURFACES),
  {
    id: 'paper',
    label: 'Panels',
    group: SURFACES,
    palette: 'background.paper',
  },
  css('findBorder', 'Find bar border', FIND),
  css('findInputBorder', 'Find box border', FIND),
  css('findStatus', 'Find status', FIND),
  css('findProblem', 'Find problem', FIND),
  css('searchMatch', 'Match', FIND),
  css('searchMatchCurrent', 'Current match', FIND),
  { id: 'selected', label: 'Selected', group: MUI, palette: 'action.selected' },
  { id: 'hover', label: 'Hover', group: MUI, palette: 'action.hover' },
];

// What the poet has chosen, per scheme, by colour id. A colour not here is its default.
export type Choices = Record<Scheme, Record<string, string>>;
export const noChoices = (): Choices => ({ light: {}, dark: {} });

// ---- Colour values -------------------------------------------------------------------------------------

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

// The colour formats cssVars.css and theme.ts use: #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(). Anything else
// (a named colour, say) is null, and the picker shows the value as it is without offering to edit it in RGB.
export const parseColour = (value: string): Rgba | null => {
  const v = value.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
    return { r, g, b, a: m[4] === undefined ? 1 : parseInt(m[4], 16) / 255 };
  }
  m = v.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/
  );
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if ([r, g, b].some((c) => c > 255) || !Number.isFinite(a) || a > 1)
      return null;
    return { r, g, b, a };
  }
  return null;
};

// #rrggbb, or #rrggbbaa when the colour is not opaque: the hex code Annelyse reads and can type.
export const toHex = ({ r, g, b, a }: Rgba): string =>
  `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ''}`;

// The RGB a native colour input or the eyedropper chose, keeping the transparency the colour had, since
// neither of them chooses one.
export const withRgb = (rgbHex: string, previous: string): string | null => {
  const chosen = parseColour(rgbHex);
  if (!chosen) return null;
  const before = parseColour(previous);
  return toHex({ ...chosen, a: before ? before.a : 1 });
};

// ---- Applying choices ----------------------------------------------------------------------------------

// The CSS that puts the chosen variables over cssVars.css. `:root:root` outranks cssVars.css's `:root`
// whatever order the stylesheets load in. Each scheme's choices sit in that scheme's media block, light
// included: cssVars.css's light values apply in both schemes until its dark block overrides them, so a light
// choice outside a media block would outrank the dark defaults too (alden-ec2221c7, review of #472).
export const cssText = (choices: Choices): string => {
  const block = (scheme: Scheme) =>
    AUDITION_COLOURS.filter((c) => c.css && choices[scheme][c.id] !== undefined)
      .map(
        (c) => `${CSS_VARS[c.css as CssVarKey].name}: ${choices[scheme][c.id]};`
      )
      .join(' ');
  const light = block('light');
  const dark = block('dark');
  return [
    light && `@media (prefers-color-scheme: light) { :root:root { ${light} } }`,
    dark && `@media (prefers-color-scheme: dark) { :root:root { ${dark} } }`,
  ]
    .filter(Boolean)
    .join('\n');
};

// The scheme's MUI theme options with the chosen palette colours in place.
export const themeWith = (
  base: ThemeOptions,
  chosen: Record<string, string>
): ThemeOptions => {
  const palette: Record<string, Record<string, string>> = {};
  Object.entries(base.palette ?? {}).forEach(([section, value]) => {
    if (value && typeof value === 'object')
      palette[section] = { ...(value as Record<string, string>) };
  });
  AUDITION_COLOURS.forEach((c) => {
    const value = chosen[c.id];
    if (!c.palette || value === undefined) return;
    const [section, field] = c.palette.split('.');
    palette[section] = { ...(palette[section] ?? {}), [field]: value };
  });
  return { ...base, palette: { ...base.palette, ...palette } };
};

// ---- Keeping choices -----------------------------------------------------------------------------------

export const STORAGE_KEY = 'midst.colourAudition.v1';

// What was kept, or none if there is nothing, it cannot be read, or it is not colours. Only known ids and
// values parseColour understands survive, so a stored value can never put arbitrary text into the CSS.
export const loadChoices = (storage: Pick<Storage, 'getItem'>): Choices => {
  const choices = noChoices();
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return choices;
  }
  if (!raw || typeof raw !== 'object') return choices;
  const ids = new Set(AUDITION_COLOURS.map((c) => c.id));
  SCHEMES.forEach((scheme) => {
    const kept = (raw as Record<string, unknown>)[scheme];
    if (!kept || typeof kept !== 'object') return;
    Object.entries(kept as Record<string, unknown>).forEach(([id, value]) => {
      if (ids.has(id) && typeof value === 'string' && parseColour(value))
        choices[scheme][id] = value;
    });
  });
  return choices;
};

export const saveChoices = (
  storage: Pick<Storage, 'setItem'>,
  choices: Choices
): boolean => {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(choices));
    return true;
  } catch {
    return false;
  }
};

// Every colour's hex code in one scheme, chosen or default, to paste into a message: what Annelyse sends us.
export const hexList = (
  scheme: Scheme,
  // eslint-disable-next-line no-unused-vars -- a parameter named in a function type
  value: (c: AuditionColour) => string
): string =>
  AUDITION_COLOURS.map((c) => {
    const v = value(c);
    const rgba = parseColour(v);
    return `${c.group} / ${c.label}: ${rgba ? toHex(rgba) : v}`;
  }).join('\n');
