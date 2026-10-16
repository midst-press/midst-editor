import { Theme } from '@mui/material/styles';

// The colours the renderer draws with, as CSS custom properties (GitHub #15; plain CSS, no styling library, per
// Gitea #129). Each is named once here, so a component writes cssVar('background') and a misspelt key fails to
// compile. The values are set at the root by cssVars.css, once for the light scheme and once for the dark
// (GitHub #16). Those with `from` come from the MUI theme (theme.ts), and a test holds each scheme's value equal
// to that scheme's theme, so the two cannot drift. The rest are the interface's own neutrals, which MUI does not
// supply.
// eslint-disable-next-line no-unused-vars -- the base rule reports a parameter named in a function type
type CssVar = { name: string; from?: (t: Theme) => string };

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
  errorLight: {
    name: '--midst-error-light',
    from: (t: Theme) => t.palette.error.light,
  },
  textPrimary: {
    name: '--midst-text-primary',
    from: (t: Theme) => t.palette.text.primary,
  },
  // Replay's control bar, its icons and their hover. Pink in the light scheme, dark rose in the dark.
  controlBar: { name: '--midst-control-bar' },
  onControlBar: { name: '--midst-on-control-bar' },
  controlBarHover: { name: '--midst-control-bar-hover' },
  // The opening screen's welcome card, what is written on it, and its logo. Pink in the light scheme,
  // dark rose in the dark, so the card is never a bright block in a dark window.
  card: { name: '--midst-card' },
  onCard: { name: '--midst-on-card' },
  logo: { name: '--midst-logo' },
  // Title bar drop-down menus, the replay slider's value label, its custom tooltips.
  surface: { name: '--midst-surface' },
  // The window title and the editor's icon buttons.
  mutedText: { name: '--midst-muted-text' },
  scrollbarThumb: { name: '--midst-scrollbar-thumb' },
  tooltipText: { name: '--midst-tooltip-text' },
  // The opening screen's file buttons, and its link.
  buttonBackground: { name: '--midst-button-background' },
  buttonHover: { name: '--midst-button-hover' },
  buttonText: { name: '--midst-button-text' },
  link: { name: '--midst-link' },
  // The find bar.
  findBorder: { name: '--midst-find-border' },
  findInputBorder: { name: '--midst-find-input-border' },
  findStatus: { name: '--midst-find-status' },
  findProblem: { name: '--midst-find-problem' },
  searchMatch: { name: '--midst-search-match' },
  searchMatchCurrent: { name: '--midst-search-match-current' },
} as const satisfies Record<string, CssVar>;

export type CssVarKey = keyof typeof CSS_VARS;

/** `var(--midst-…)` for an inline style. */
export const cssVar = (key: CssVarKey) => `var(${CSS_VARS[key].name})`;
