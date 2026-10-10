#!/bin/bash
# The version poets see comes from release/app/package.json: electron-builder's two-package.json
# layout reads it from there (app-builder-lib packager.js), for the installer file names, the
# macOS bundle version and the Windows file version. The repository root records the same number
# for tooling. This fails if any of the six places that record it disagree, so a release cannot
# be built with a version the installers do not carry. Run by pre-commit, and so by CI.
#
# Change the version with tools/set_version.sh, never by hand.
set -euo pipefail
cd "$(dirname "$0")/.."

node - <<'JS'
const fs = require('fs');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const source = 'release/app/package.json';
const want = read(source).version;
const found = {
  [source]: want,
  'release/app/package-lock.json': read('release/app/package-lock.json').version,
  'release/app/package-lock.json packages[""]': read('release/app/package-lock.json').packages[''].version,
  'package.json': read('package.json').version,
  'package-lock.json': read('package-lock.json').version,
  'package-lock.json packages[""]': read('package-lock.json').packages[''].version,
};
const wrong = Object.entries(found).filter(([, v]) => v !== want);
if (!/^\d+\.\d+\.\d+$/.test(want)) {
  console.error(`${source} has version "${want}", which is not MAJOR.MINOR.PATCH`);
  process.exit(1);
}
if (wrong.length) {
  console.error(`The version is ${want} in ${source}, but:`);
  for (const [f, v] of wrong) console.error(`  ${f}: ${v}`);
  console.error('Set it everywhere with: tools/set_version.sh <version>');
  process.exit(1);
}
console.log(`version ${want}, consistent in all six places`);
JS
