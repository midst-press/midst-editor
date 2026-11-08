import { createTheme } from '@mui/material/styles';
import themeObj, { darkThemeObj } from '../theme';
import { CSS_VARS } from '../cssVars';
import { AUDITION_COLOURS, AuditionColour, Scheme, SCHEMES } from './colours';

// The colours as the app ships them, so the picker can show each default and revert to it. The variables are
// read from cssVars.css as the page loaded it, not restated here, so this can never disagree with that file.
// The palette-only colours come from the MUI themes in theme.ts.

export type Defaults = Record<Scheme, Record<string, string>>;

const isDark = (rule: CSSMediaRule) =>
  /prefers-color-scheme\s*:\s*dark/.test(rule.media.mediaText);

const rootVars = (rules: CSSRuleList, into: Record<string, string>) => {
  Array.from(rules).forEach((rule) => {
    const style = rule as CSSStyleRule;
    if (style.selectorText !== ':root') return;
    Array.from(style.style).forEach((name) => {
      if (name.startsWith('--midst-'))
        into[name] = style.style.getPropertyValue(name).trim();
    });
  });
};

// Every `--midst-` variable the page's stylesheets set at :root, light and in the dark media block. The
// audition's own stylesheet is skipped, so what it has chosen is never mistaken for a default.
export const cssDefaults = (
  doc: Document,
  skip: CSSStyleSheet | null
): Record<Scheme, Record<string, string>> => {
  const found: Record<Scheme, Record<string, string>> = { light: {}, dark: {} };
  Array.from(doc.styleSheets).forEach((sheet) => {
    if (sheet === skip) return;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      return; // a stylesheet from elsewhere, which cannot be read; the app has none
    }
    rootVars(rules, found.light);
    Array.from(rules).forEach((rule) => {
      if (rule instanceof CSSMediaRule && isDark(rule))
        rootVars(rule.cssRules, found.dark);
    });
  });
  return found;
};

const themes = {
  light: createTheme(themeObj),
  dark: createTheme(darkThemeObj),
};

const fromPalette = (scheme: Scheme, path: string): string | undefined => {
  const [section, field] = path.split('.');
  const value = (
    themes[scheme].palette as unknown as Record<string, Record<string, unknown>>
  )[section]?.[field];
  return typeof value === 'string' ? value : undefined;
};

export const defaultsFrom = (
  doc: Document,
  skip: CSSStyleSheet | null
): Defaults => {
  const vars = cssDefaults(doc, skip);
  const value = (scheme: Scheme, c: AuditionColour) =>
    (c.css && vars[scheme][CSS_VARS[c.css].name]) ||
    (c.palette && fromPalette(scheme, c.palette)) ||
    '';
  const defaults: Defaults = { light: {}, dark: {} };
  SCHEMES.forEach((scheme) => {
    AUDITION_COLOURS.forEach((c) => {
      defaults[scheme][c.id] = value(scheme, c);
    });
  });
  return defaults;
};
