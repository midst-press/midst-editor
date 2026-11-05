# Fonts that come with Midst

Both fonts are from [google/fonts](https://github.com/google/fonts) at commit
`bbda7253fc363238b05d97515ca71f8ae49c4fa9`, under the SIL Open Font License 1.1. Each font's `OFL.txt`
sits beside it and ships with the app.

| File here                                               | Upstream path                                          |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `jost/Jost-Variable.ttf`                                | `ofl/jost/Jost[wght].ttf`                              |
| `jost/Jost-Italic-Variable.ttf`                         | `ofl/jost/Jost-Italic[wght].ttf`                       |
| `libre-caslon-text/LibreCaslonText-Variable.ttf`        | `ofl/librecaslontext/LibreCaslonText[wght].ttf`        |
| `libre-caslon-text/LibreCaslonText-Italic-Variable.ttf` | `ofl/librecaslontext/LibreCaslonText-Italic[wght].ttf` |

The files are renamed only to drop the brackets. Their bytes are unchanged.

`fonts.css` declares them. `APP_FONT_STACK` in `../poemFont/poemFont.ts` makes Jost the app's own font, and
`BUNDLED_FONTS` there lists Libre Caslon Text in View > Font.
