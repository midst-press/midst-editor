import { createTheme } from '@mui/material/styles';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import themeObj, { darkThemeObj } from '../renderer/theme';
import { CSS_VARS, cssVar } from '../renderer/cssVars';
import { TITLEBAR_BACKGROUND } from '../main/appearance';

// GitHub #15: the colours are CSS custom properties set at the root by cssVars.css. GitHub #16: once for the
// light scheme and once for the dark. These tests hold that file, the names in cssVars.ts and each scheme's MUI
// theme to one another, so later changes cannot make them disagree, and hold the dark scheme to WCAG AA.
const RENDERER = join(__dirname, '..', 'renderer');
const ROOT_CSS = readFileSync(join(RENDERER, 'cssVars.css'), 'utf8');

// Colours compared without regard to case or spaces: '#FFF5EE' is '#fff5ee', 'rgb(1,2,3)' is 'rgb(1, 2, 3)'.
const norm = (value: string) => value.toLowerCase().replace(/\s+/g, '');

const declarations = (block: string) =>
  new Map(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ])
  );

const DARK_BLOCK =
  /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*{\s*:root\s*{([^}]*)}\s*}/;

const scheme = {
  light: (() => {
    const root = ROOT_CSS.replace(DARK_BLOCK, '').match(/:root\s*{([^}]*)}/);
    if (!root) throw new Error('cssVars.css has no light :root block');
    return declarations(root[1]);
  })(),
  dark: (() => {
    const root = ROOT_CSS.match(DARK_BLOCK);
    if (!root) throw new Error('cssVars.css has no dark :root block');
    return declarations(root[1]);
  })(),
};

const themes = {
  light: createTheme(themeObj),
  dark: createTheme(darkThemeObj),
};

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

const stylesheets = () =>
  filesUnder(RENDERER).filter(
    (f) => f.endsWith('.css') && !f.endsWith('cssVars.css')
  );

const named: string[] = Object.values(CSS_VARS).map(({ name }) => name);

describe.each(['light', 'dark'] as const)('the %s scheme', (which) => {
  const declared = scheme[which];

  it.each(
    Object.entries(CSS_VARS).flatMap(([key, v]) =>
      'from' in v ? [[key, v.name, v.from] as const] : []
    )
  )('%s is declared with the theme value', (_key, name, from) => {
    expect(declared.has(name)).toBe(true);
    expect(norm(declared.get(name) as string)).toBe(norm(from(themes[which])));
  });

  it('declares every property cssVars.ts names, and nothing else', () => {
    expect([...declared.keys()].sort()).toEqual([...named].sort());
  });

  it('gives the title bar the page background', () => {
    expect(norm(TITLEBAR_BACKGROUND[which])).toBe(
      norm(declared.get('--midst-background') as string)
    );
  });
});

describe('the CSS custom properties', () => {
  it('every var(--midst-…) the renderer uses is named', () => {
    const used = filesUnder(RENDERER)
      .filter((f) => /\.(css|tsx?)$/.test(f))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/var\((--midst-[\w-]+)/g)].map(
          (m) => m[1]
        )
      );
    expect(used.length).toBeGreaterThan(25);
    expect([...new Set(used)].filter((n) => !named.includes(n))).toEqual([]);
  });

  it('no stylesheet repeats a colour instead of using its property', () => {
    const replaced = [
      '#ffced4',
      '#ffa4b9',
      '#fff5ee',
      '#ffdde1',
      'rgb(255,182,199)',
      ...[...scheme.light.values()].map(norm),
    ];
    const repeats = stylesheets().flatMap((f) => {
      // Declarations only, so a colour named in a comment is not a repeat.
      const css = norm(
        readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      );
      return replaced
        .filter((c) =>
          new RegExp(`:${c.replace(/[()#.]/g, '\\$&')}[;!]`).test(css)
        )
        .map((c) => `${f}: ${c}`);
    });
    expect(repeats).toEqual([]);
  });

  it('cssVar gives the var() for a key', () => {
    expect(cssVar('background')).toBe('var(--midst-background)');
  });
});

// WCAG 2.2 contrast: 4.5:1 for text (1.4.3), 3:1 for a control's boundary (1.4.11). A colour with alpha is
// composited over what it is drawn on first.
type Rgb = [number, number, number];
const parse = (value: string): { rgb: Rgb; alpha: number } => {
  const v = norm(value);
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((c) => c + c)
            .join('')
        : hex[1];
    return {
      rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb,
      alpha: 1,
    };
  }
  const fn = v.match(/^rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/);
  if (!fn) throw new Error(`cannot read the colour ${value}`);
  return {
    rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])],
    alpha: fn[4] === undefined ? 1 : Number(fn[4]),
  };
};
const over = (fg: string, bg: Rgb): Rgb => {
  const { rgb, alpha } = parse(fg);
  return rgb.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;
};
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('the dark scheme meets WCAG AA', () => {
  const dark = (name: string) => {
    const value = scheme.dark.get(`--midst-${name}`);
    if (value === undefined) throw new Error(`--midst-${name} is not declared`);
    return value;
  };
  // A background is opaque or composited over the page background.
  const ground = (name: string) =>
    over(dark(name), parse(dark('background')).rgb);
  const contrast = (fg: string, bg: string) =>
    ratio(over(dark(fg), ground(bg)), ground(bg));

  it.each([
    ['text-primary', 'background'],
    ['text-primary', 'surface'],
    ['muted-text', 'background'],
    ['muted-text', 'surface'],
    ['error-light', 'background'],
    ['find-status', 'background'],
    ['find-problem', 'background'],
    ['text-primary', 'search-match'],
    ['text-primary', 'search-match-current'],
    ['secondary-contrast-text', 'primary-dark'],
    ['tooltip-text', 'primary-dark'],
    ['primary-dark', 'surface'],
    ['on-primary', 'primary'],
    ['link', 'primary'],
    ['button-text', 'button-background'],
    ['button-text', 'button-hover'],
  ])('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('the find field’s border is at least 3:1 against the find bar', () => {
    expect(contrast('find-input-border', 'background')).toBeGreaterThanOrEqual(
      3
    );
  });

  it('measures a known pair correctly', () => {
    expect(ratio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(ratio(parse('#777').rgb, [255, 255, 255])).toBeCloseTo(4.48, 2);
  });
});
