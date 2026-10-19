// The message catalog (midst-infra docs/design/message-catalog.md). Ids are explicit and stable
// (`menu.file.saveAs`), never the English text, so the English can change without changing a key.
// locales/en is complete and is the source. Another language may be partial, and a key it lacks
// compiles to the English.
//
// The compiled catalogs (locales/<lang>/messages.ts) are generated and gitignored. `npm run
// catalog:compile` writes them, and build, start, test and package each run it first.
const { formatter } = require('@lingui/format-po');

module.exports = {
  locales: ['en'],
  sourceLocale: 'en',
  fallbackLocales: { default: 'en' },
  catalogs: [
    { path: '<rootDir>/locales/{locale}/messages', include: ['<rootDir>/src'] },
  ],
  // No line numbers: an edit elsewhere in a file would rewrite every entry's reference.
  format: formatter({ lineNumbers: false }),
  compileNamespace: 'ts',
  // Sorted by id, so extract writes the same file every time and keys sharing a prefix sit together.
  orderBy: 'messageId',
};
