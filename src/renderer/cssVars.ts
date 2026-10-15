import { Theme } from '@mui/material/styles';

// The colours the renderer draws with, as CSS custom properties (GitHub #15; plain CSS, no styling library, per
// Gitea #129). Each is named once here, with where its value comes from in the MUI theme (theme.ts), so a
// component writes cssVar('background') and a misspelt key fails to compile. The values themselves are set at
// the root by cssVars.css, which a test holds equal to the theme, so the two cannot drift.
export const CSS_VARS = {
  background: {
    name: '--midst-background',
    from: (t: Theme) => t.palette.background.default,
  },
  primary: {
    name: '--midst-primary',
    from: (t: Theme) => t.palette.primary.main,
  },
  primaryDark: {
    name: '--midst-primary-dark',
    from: (t: Theme) => t.palette.primary.dark,
  },
  secondaryLight: {
    name: '--midst-secondary-light',
    from: (t: Theme) => t.palette.secondary.light,
  },
  secondaryContrastText: {
    name: '--midst-secondary-contrast-text',
    from: (t: Theme) => t.palette.secondary.contrastText,
  },
  errorLight: {
    name: '--midst-error-light',
    from: (t: Theme) => t.palette.error.light,
  },
  textPrimary: {
    name: '--midst-text-primary',
    from: (t: Theme) => t.palette.text.primary,
  },
} as const;

export type CssVarKey = keyof typeof CSS_VARS;

/** `var(--midst-…)` for an inline style. */
export const cssVar = (key: CssVarKey) => `var(${CSS_VARS[key].name})`;
