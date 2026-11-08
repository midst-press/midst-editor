/**
 * @jest-environment node
 */
// happy-dom's Window needs Node's globals, which the jsdom environment does not give it (alden-ec2221c7).
import { createTheme } from '@mui/material/styles';
import { readFileSync } from 'fs';
import { Window } from 'happy-dom';
import { join } from 'path';
import themeObj, { darkThemeObj } from '../renderer/theme';
import { CSS_VARS } from '../renderer/cssVars';
import {
  Choices,
  Scheme,
  cssText,
  noChoices,
  themeWith,
} from '../renderer/colourAudition/colours';

// View > Colours… (GitHub #119): what a window actually draws with. cssVars.css and the audition's CSS are
// cascaded by a real CSS engine in the scheme given, not searched as text (alden-ec2221c7's method, review of
// #472, where a light choice was found overriding the dark default).

const ROOT_CSS = readFileSync(
  join(__dirname, '..', 'renderer', 'cssVars.css'),
  'utf8'
);
const SHIPPED: Record<Scheme, string> = { light: '#fff5ee', dark: '#1f1a1c' };
const BASES = { light: themeObj, dark: darkThemeObj };

const background = (scheme: Scheme, choices: Choices): string => {
  const win = new Window({
    settings: { device: { prefersColorScheme: scheme } },
  });
  [ROOT_CSS, cssText(choices)].forEach((text) => {
    const style = win.document.createElement('style');
    style.textContent = text;
    win.document.head.appendChild(style);
  });
  const value = win
    .getComputedStyle(win.document.documentElement)
    .getPropertyValue(CSS_VARS.background.name)
    .trim()
    .toLowerCase();
  win.close();
  return value;
};

const LIGHT = { light: { background: '#123456' }, dark: {} };
const DARK = { light: {}, dark: { background: '#654321' } };
const BOTH = {
  light: { background: '#123456' },
  dark: { background: '#654321' },
};

describe('each scheme draws its own colours', () => {
  it.each([
    ['nothing chosen', noChoices(), SHIPPED],
    ['a light choice only', LIGHT, { light: '#123456', dark: SHIPPED.dark }],
    ['a dark choice only', DARK, { light: SHIPPED.light, dark: '#654321' }],
    ['a choice in each', BOTH, { light: '#123456', dark: '#654321' }],
  ] as [string, Choices, Record<Scheme, string>][])(
    '%s',
    (_name, choices, expected) => {
      (['light', 'dark'] as const).forEach((scheme) => {
        expect(background(scheme, choices)).toBe(expected[scheme]);
        // MUI is built from the same scheme's choices, so it draws the same colour.
        const mui = createTheme(themeWith(BASES[scheme], choices[scheme]))
          .palette.background.default;
        expect(mui.toLowerCase()).toBe(expected[scheme]);
      });
    }
  );

  it('reverting Dark gives back the dark default while a light choice remains', () => {
    expect(background('dark', { ...BOTH, dark: {} })).toBe(SHIPPED.dark);
  });
});
