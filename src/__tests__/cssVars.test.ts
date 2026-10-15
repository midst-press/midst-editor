import { createTheme } from '@mui/material/styles';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import themeObj from '../renderer/theme';
import { CSS_VARS, cssVar } from '../renderer/cssVars';

// GitHub #15: the colours are CSS custom properties set at the root by cssVars.css. These tests hold that file,
// the names in cssVars.ts and the MUI theme to one another, so moving the values changed nothing on screen and
// later changes cannot make them disagree.
const RENDERER = join(__dirname, '..', 'renderer');
const ROOT_CSS = readFileSync(join(RENDERER, 'cssVars.css'), 'utf8');

// Colours compared without regard to case or spaces: '#FFF5EE' is '#fff5ee', 'rgb(1,2,3)' is 'rgb(1, 2, 3)'.
const norm = (value: string) => value.toLowerCase().replace(/\s+/g, '');

const declared = (() => {
  const root = ROOT_CSS.match(/:root\s*{([^}]*)}/);
  if (!root) throw new Error('cssVars.css has no :root block');
  return new Map(
    [...root[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ])
  );
})();

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

describe('the CSS custom properties', () => {
  const theme = createTheme(themeObj);

  it.each(Object.entries(CSS_VARS))(
    '%s is declared at the root with the theme value',
    (_key, { name, from }) => {
      expect(declared.has(name)).toBe(true);
      expect(norm(declared.get(name) as string)).toBe(norm(from(theme)));
    }
  );

  it('declares nothing cssVars.ts does not name', () => {
    const named = new Set<string>(
      Object.values(CSS_VARS).map(({ name }) => name)
    );
    expect([...declared.keys()].filter((n) => !named.has(n))).toEqual([]);
  });

  it('every var(--midst-…) the renderer uses is declared', () => {
    const used = filesUnder(RENDERER)
      .filter((f) => /\.(css|tsx?)$/.test(f))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/var\((--midst-[\w-]+)/g)].map(
          (m) => m[1]
        )
      );
    expect(used.length).toBeGreaterThan(10);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });

  it('no stylesheet repeats a theme colour instead of using its property', () => {
    const palette = [
      '#ffced4',
      '#ffa4b9',
      '#fff5ee',
      '#ffdde1',
      'rgb(255,182,199)',
    ];
    const repeats = filesUnder(RENDERER)
      .filter((f) => f.endsWith('.css') && !f.endsWith('cssVars.css'))
      .filter((f) =>
        palette.some((c) => norm(readFileSync(f, 'utf8')).includes(c))
      );
    expect(repeats).toEqual([]);
  });

  it('cssVar gives the var() for a key', () => {
    expect(cssVar('background')).toBe('var(--midst-background)');
  });
});
