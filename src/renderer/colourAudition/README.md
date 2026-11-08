# Colour audition (GitHub #119, editor #468)

View > Colours…: Annelyse auditions the app's colours, light and dark separately, and sends us the hex
codes she chooses. It is not in a release. It is built only when `MIDST_COLOUR_AUDITION=true` is set at
build time, which the package workflow does when its `colour_audition` input is on. With the flag off,
none of this folder's code is bundled.

Her choices are kept in the window's localStorage (`midst.colourAudition.v1`), on that computer only.

## Removing it entirely

1. Delete this folder.
2. `src/renderer/App.tsx`: the `ColourAudition` lines (the import and the wrapper it chooses).
3. `src/main/menu.ts`: the `menu.view.colours` item.
4. `src/shared/channels.ts`: `'choose-colours'`.
5. `.erb/configs/webpack.config.base.ts`: `MIDST_COLOUR_AUDITION` in the EnvironmentPlugin.
6. `.github/workflows/package.yml`: the `colour_audition` input and its uses.
