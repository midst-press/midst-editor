#!/bin/bash
# Checks that a downloaded package run is fit to release, before anything is tagged or published:
#
#     tools/verify_candidate.sh <download dir> <commit the run built>
#
# The download dir holds the run's artifacts as `gh run download` lays them out: one folder per
# artifact, including build-info-<platform>/<platform>.json. It requires:
#   - build-info for macos, windows and linux, all at one version and that commit;
#   - the macOS installer signed AND notarised;
#   - every installer build-info lists present, with the SHA-256 it recorded at build time,
#     so what is released is byte-for-byte what was built and tested.
# On success it prints the version, and writes <download dir>/release/ holding the installers
# (spaces in names replaced, as GitHub would) and SHA256SUMS.
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: $0 <download dir> <commit>" >&2; exit 2; }
DIR=$1 COMMIT=$2 node - <<'JS'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = process.env.DIR;
const commit = process.env.COMMIT;
const fail = (msg) => { console.error(`not releasable: ${msg}`); process.exit(1); };
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Every file in the download, by name, with where it is.
const all = new Map();
for (const sub of fs.readdirSync(dir)) {
  const p = path.join(dir, sub);
  if (!fs.statSync(p).isDirectory() || sub === 'release') continue;
  for (const f of fs.readdirSync(p)) all.set(f, path.join(p, f));
}

const platforms = ['macos', 'windows', 'linux'];
const infos = platforms.map((pl) => {
  const f = all.get(`${pl}.json`);
  if (!f) fail(`no build-info for ${pl} (was this run built before build-info existed, or not for all platforms?)`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
});

const version = infos[0].version;
if (!/^\d+\.\d+\.\d+$/.test(version || '')) fail(`version "${version}" is not MAJOR.MINOR.PATCH`);
for (const i of infos) {
  if (i.version !== version) fail(`${i.platform} is version ${i.version}, macos is ${version}`);
  if (i.commit !== commit) fail(`${i.platform} was built from ${i.commit}, not ${commit}`);
  if (i.ref !== 'refs/heads/main') fail(`${i.platform} was built from ${i.ref}, not main`);
  if (!i.files || i.files.length === 0) fail(`${i.platform} recorded no installers`);
}
const mac = infos[0];
if (!mac.signed || !mac.notarised) fail(`the macOS installer was not signed and notarised (signed=${mac.signed}, notarised=${mac.notarised})`);

const out = path.join(dir, 'release');
fs.mkdirSync(out, { recursive: true });
const sums = [];
for (const i of infos) {
  for (const { name, sha256: want } of i.files) {
    const f = all.get(name);
    if (!f) fail(`${i.platform}: ${name} is listed in build-info but missing from the artifacts`);
    const got = sha256(f);
    if (got !== want) fail(`${name}: SHA-256 is ${got}, build-info recorded ${want}`);
    const published = name.replace(/ /g, '-');
    fs.copyFileSync(f, path.join(out, published));
    sums.push(`${want}  ${published}`);
  }
}
fs.writeFileSync(path.join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.error(`releasable: ${version} from ${commit}`);
for (const s of sums) console.error(`  ${s}`);
console.log(version);
JS
