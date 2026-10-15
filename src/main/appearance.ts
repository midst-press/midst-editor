// The poet's light or dark choice (GitHub #16), shared by the main process and the preload script.
// No imports, so either can bundle it.
//
// The choice is an app preference, kept in the store under 'appearance', never in the poem. Its values
// are Electron's nativeTheme.themeSource values, so the main process sets that directly: 'system'
// follows the OS, and the renderer's prefers-color-scheme follows whichever is in force. Until the poet
// chooses, there is no stored value and the app follows the OS.

export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof APPEARANCES)[number];

export const DEFAULT_APPEARANCE: Appearance = 'system';

export const appearanceOrDefault = (stored: unknown): Appearance =>
  APPEARANCES.find((a) => a === stored) ?? DEFAULT_APPEARANCE;

// The title bar is drawn by the preload script, outside the renderer's stylesheet, so it takes the page
// background from here. A test holds these equal to --midst-background in each block of cssVars.css.
export const TITLEBAR_BACKGROUND = {
  light: '#FFF5EE',
  dark: '#1F1A1C',
} as const;
