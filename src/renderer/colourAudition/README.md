# Colour audition (GitHub #119, editor #468)

View > Colours…: Annelyse auditions the app's colours, light and dark separately, and sends us the hex
codes she chooses. It is not in a release. It is built only when `MIDST_COLOUR_AUDITION=true` is set at
build time, which the package workflow does when its `colour_audition` input is on. With the flag off,
none of this folder's code is bundled.

Her choices are kept in the window's localStorage (`midst.colourAudition.v1`), on that computer only.

The panel can also draw a replacement for the squiggly M, read from an `.svg` file, and give it an outline
(`logo.ts`). That is kept in `midst.colourAudition.logo.v2` (a window with only the older `.v1` reads that once). The app's own logo is `assets/midst-logo.svg`,
which stays when this folder goes.

## Removing it entirely

1. Delete this folder.
2. `src/renderer/App.tsx`: the `ColourAudition` lines (the import and the wrapper it chooses).
3. `src/main/menu.ts`: the `menu.view.colours` item.
4. `src/shared/channels.ts`: `'choose-colours'`.
5. `.erb/configs/webpack.config.base.ts`: `MIDST_COLOUR_AUDITION` in the EnvironmentPlugin.
6. `.github/workflows/package.yml`: the `colour_audition` input and its uses.
7. `src/main/colourAudition.ts`; in `src/main/main.ts`, the guarded `require` of it; in `src/main/preload.ts`, `colourFiles` (its `readLogo` included), `titlebarColours`, and `chosenTitlebar` with `redrawTitlebar` (the title bar then takes `TITLEBAR_BACKGROUND` alone again).
8. The tests: `src/__tests__/colourAudition.test.tsx`, `src/__tests__/colourAuditionCascade.test.ts`, `src/__tests__/colourAuditionFiles.test.ts`, `src/__tests__/colourAuditionLogo.test.ts`, the Colours case in `src/__tests__/menu.test.ts`, and "typing in the Colours panel leaves the poem as it was" in `src/__tests__/Editor.test.tsx`. Keep `src/renderer/keepsFocus.ts` and the editor's test of it: other panels can use it.
