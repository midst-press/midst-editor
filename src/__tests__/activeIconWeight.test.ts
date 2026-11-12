// GitHub #119: a pressed toolbar icon is marked by colour alone. A stroke on .is-active reaches the icon's paths,
// which inherit it, and drew B, I, U and S 1px bolder when pressed (measured at 22px: bold 2.75px to 5.25px).
import { readFileSync } from 'fs';
import { join } from 'path';

const EDITOR_CSS = readFileSync(
  join(__dirname, '..', 'renderer', 'components', 'Editor', 'Editor.css'),
  'utf8'
);

// Every declaration in every rule whose selector list names .is-active.
const activeDeclarations = (css: string): string[] =>
  Array.from(
    css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)
  )
    .filter(([, selectors]) => /\.is-active\b/.test(selectors))
    .flatMap(([, , body]) =>
      body
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
    );

describe('a pressed toolbar icon', () => {
  it('is marked by colour', () => {
    expect(activeDeclarations(EDITOR_CSS)).toContain(
      'color: var(--midst-active-icon)'
    );
  });

  it('sets no stroke, which the icon would inherit and draw bolder', () => {
    expect(
      activeDeclarations(EDITOR_CSS).filter((d) => /^stroke/.test(d))
    ).toEqual([]);
  });

  it('would be caught if a stroke came back', () => {
    expect(
      activeDeclarations('.is-active { stroke: red; color: blue; }').filter(
        (d) => /^stroke/.test(d)
      )
    ).toEqual(['stroke: red']);
  });
});
