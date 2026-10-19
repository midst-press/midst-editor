/* eslint-disable no-restricted-syntax, no-continue -- plain loops over a directory listing */
// Is every compiled message catalog present and at least as new as the .po it comes from?
//
// The compiled catalogs (locales/<lang>/messages.ts) are generated and gitignored, so a build
// could otherwise read a missing one, or an old one that predates an edit to the words. `npm run
// build`, `start` and `test` compile first. This covers the entry points that don't, such as
// `npm run build:main` on its own: the webpack config calls it and refuses to build.
//
// It only reads. Writing here would race when `build` runs the main and renderer builds at once.
const fs = require('fs');
const path = require('path');

/** Problems with the compiled catalogs under `root`, as sentences; empty when all are current. */
function staleCatalogs(root) {
  const locales = path.join(root, 'locales');
  const problems = [];
  for (const lang of fs.readdirSync(locales).sort()) {
    const po = path.join(locales, lang, 'messages.po');
    if (!fs.existsSync(po)) continue;
    const compiled = path.join(locales, lang, 'messages.ts');
    const shown = path.relative(root, compiled);
    if (!fs.existsSync(compiled)) {
      problems.push(`${shown} is missing.`);
    } else if (fs.statSync(compiled).mtimeMs < fs.statSync(po).mtimeMs) {
      problems.push(`${shown} is older than ${path.relative(root, po)}.`);
    }
  }
  return problems;
}

/** Throw, naming each problem and the fix, unless every compiled catalog is current. */
function assertCatalogsCompiled(root) {
  const problems = staleCatalogs(root);
  if (problems.length > 0) {
    throw new Error(
      `The message catalog is not compiled for this build. ${problems.join(
        ' '
      )} Run "npm run catalog:compile".`
    );
  }
}

/**
 * The same check as a webpack plugin. It runs when a compile starts, not when the config loads, so
 * ESLint's import resolver, which loads the renderer config without compiling, never trips it.
 */
class CatalogFreshnessPlugin {
  constructor(root) {
    this.root = root;
  }

  apply(compiler) {
    const check = () => assertCatalogsCompiled(this.root);
    compiler.hooks.beforeRun.tap('CatalogFreshnessPlugin', check);
    compiler.hooks.watchRun.tap('CatalogFreshnessPlugin', check);
  }
}

module.exports = {
  staleCatalogs,
  assertCatalogsCompiled,
  CatalogFreshnessPlugin,
};
