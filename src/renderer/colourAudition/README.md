# Colour audition (GitHub #119, editor #468)

View > Colours…: Annelyse auditions the app's colours, light and dark separately, and sends us the hex
codes she chooses. It is in pre-release builds, releases included, by Stuart's decision of 12 Nov 2026,
so that she can go through it with a designer in one build. It is built while `MIDST_COLOUR_AUDITION` is
`true`, which `.erb/configs/webpack.config.base.ts` makes the default. Building with
`MIDST_COLOUR_AUDITION=false` leaves all of this folder's code out. Removing it entirely is the list below.

Her choices are kept in the window's localStorage (`midst.colourAudition.v1`), on that computer only.

The panel can also draw a replacement for the squiggly M, read from an `.svg` file, and give it an outline
(`logo.ts`). That is kept in `midst.colourAudition.logo.v2` (a window with only the older `.v1` reads that once). The app's own logo is `assets/midst-logo.svg`,
which stays when this folder goes.

## Turning it off

One line: in `.erb/configs/webpack.config.base.ts`, set the `MIDST_COLOUR_AUDITION` default to `'false'`.
Every build then leaves this folder's code out, and View > Colours… is gone. The tests below keep passing.

## Removing it entirely

1. Delete this folder.
2. `src/renderer/App.tsx`: the `ColourAudition` lines (the import and the wrapper it chooses).
3. `src/main/menu.ts`: the `menu.view.colours` item.
4. `src/shared/channels.ts`: `'choose-colours'`.
5. `.erb/configs/webpack.config.base.ts`: `MIDST_COLOUR_AUDITION` in the EnvironmentPlugin.
6. Leave `tools/verify_candidate.sh` and `tools/release/release.sh` as they are: they refuse artifacts built with the `colour_audition` option `package.yml` had before 0.13.0.
7. `src/main/colourAudition.ts`; in `src/main/main.ts`, the guarded `require` of it; in `src/main/preload.ts`, `colourFiles` (its `readLogo` included), `titlebarColours`, and `chosenTitlebar` with `redrawTitlebar` (the title bar then takes `TITLEBAR_BACKGROUND` alone again).
8. The tests: `src/__tests__/colourAudition.test.tsx`, `src/__tests__/colourAuditionCascade.test.ts`, `src/__tests__/colourAuditionFiles.test.ts`, `src/__tests__/colourAuditionLogo.test.ts`, the Colours case in `src/__tests__/menu.test.ts`, and "typing in the Colours panel leaves the poem as it was" in `src/__tests__/Editor.test.tsx`. Keep `src/renderer/keepsFocus.ts` and the editor's test of it: other panels can use it.
