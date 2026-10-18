#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax -- a Node CLI that prints its report, over plain loops */
// Checks vendor/midst-format/ (the committed build of a midst-format tag, see its VENDOR.md).
//
//   node tools/check-vendored-format.mjs [--dir <vendor dir>]
//       Default mode, run by pre-commit and CI. Hashes every file under the directory except VENDOR.md and
//       compares with the SHA-256 block in VENDOR.md. Fails on a changed, missing or extra file. This catches
//       a hand edit to a vendored file. It cannot catch the files and the hashes being edited together:
//       that is what --rebuild is for.
//
//   node tools/check-vendored-format.mjs --rebuild [<midst-format checkout>] [--dir <vendor dir>]
//       Checks that the checkout's tag (the one VENDOR.md names) resolves to the commit VENDOR.md records,
//       builds that tag in a temporary worktree (npm ci, npm run build:lib) and byte-compares its dist/ with
//       the vendored directory, every file. The checkout defaults to $MIDST_FORMAT_ROOT. Needs network for npm ci.
//
// Prints counts and paths, never file contents. Exit: 0 verified; 1 a mismatch; 2 usage or an unreadable
// input (including a VENDOR.md with no hash block: an empty check would pass vacuously).

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDOR_MD = 'VENDOR.md';
const DEFAULT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'vendor',
  'midst-format'
);

class UsageError extends Error {}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Every file under dir as a sorted list of '/'-separated relative paths, VENDOR.md at the top excluded. */
function listFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    throw new UsageError(`${dir} is not a directory`);
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(relative(dir, p).split(sep).join('/'));
      else throw new UsageError(`${p} is not a regular file or directory`);
    }
  };
  walk(dir);
  return out.filter((f) => f !== VENDOR_MD).sort();
}

/** The `- Tag:` and `- Commit:` values and the fenced hash block of a VENDOR.md. */
function parseVendorMd(text) {
  const field = (name) => {
    const m = new RegExp(`^- ${name}: \`([^\`]+)\`$`, 'm').exec(text);
    if (!m) throw new UsageError(`${VENDOR_MD} has no '- ${name}:' line`);
    return m[1];
  };
  const block = /^```sha256\n([\s\S]*?)^```$/m.exec(text);
  if (!block) throw new UsageError(`${VENDOR_MD} has no sha256 block`);
  const hashes = new Map();
  for (const line of block[1].split('\n').filter((l) => l !== '')) {
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    if (!m) throw new UsageError(`unreadable hash line in ${VENDOR_MD}`);
    const [, hash, path] = m;
    if (path.startsWith('/') || path.split('/').includes('..'))
      throw new UsageError(
        `hash block names a path outside the directory: ${path}`
      );
    if (hashes.has(path))
      throw new UsageError(`hash block lists ${path} twice`);
    hashes.set(path, hash);
  }
  if (hashes.size === 0)
    throw new UsageError(`${VENDOR_MD} hash block is empty`);
  return { tag: field('Tag'), commit: field('Commit'), hashes };
}

function readVendorMd(dir) {
  const file = join(dir, VENDOR_MD);
  if (!existsSync(file)) throw new UsageError(`${file} does not exist`);
  return parseVendorMd(readFileSync(file, 'utf8'));
}

/** Compares the files in dir with a path -> sha256 map: { examined, changed, missing, extra }. */
function compareToHashes(dir, hashes) {
  const files = listFiles(dir);
  const present = new Set(files);
  return {
    examined: files.length,
    changed: files.filter(
      (f) =>
        hashes.has(f) && sha256(readFileSync(join(dir, f))) !== hashes.get(f)
    ),
    missing: [...hashes.keys()].filter((f) => !present.has(f)).sort(),
    extra: files.filter((f) => !hashes.has(f)),
  };
}

function report(label, r) {
  const bad = r.changed.length + r.missing.length + r.extra.length;
  console.log(
    `${label}: ${r.examined} files examined, ${r.changed.length} changed, ${r.missing.length} missing, ${r.extra.length} extra`
  );
  for (const [kind, list] of [
    ['changed', r.changed],
    ['missing', r.missing],
    ['extra', r.extra],
  ])
    for (const f of list) console.log(`  ${kind}: ${f}`);
  return bad === 0;
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.error || r.status !== 0)
    throw new UsageError(
      `${cmd} ${args.join(' ')} failed (${
        r.error ? r.error.message : `exit ${r.status}`
      }):\n${(r.stderr || '').trim().split('\n').slice(-15).join('\n')}`
    );
  return r.stdout.trim();
}

function checkHashes(dir) {
  const { tag, commit, hashes } = readVendorMd(dir);
  console.log(
    `${VENDOR_MD}: tag ${tag}, commit ${commit}, ${hashes.size} hashes`
  );
  return report('vendored files', compareToHashes(dir, hashes));
}

function rebuild(dir, checkout) {
  const { tag, commit } = readVendorMd(dir);
  const actual = run('git', ['-C', checkout, 'rev-list', '-n1', tag]);
  console.log(
    `tag ${tag} in ${checkout}: ${actual}; ${VENDOR_MD} records ${commit}`
  );
  if (actual !== commit) {
    console.log('FAIL: the tag does not resolve to the recorded commit');
    return false;
  }
  const work = mkdtempSync(join(tmpdir(), 'vendored-format-'));
  const tree = join(work, 'tree');
  let added = false;
  try {
    run('git', ['-C', checkout, 'worktree', 'add', '--detach', tree, commit]);
    added = true;
    // No scripts: the build needs none, and format's `prepare` would install git hooks into the caller's own
    // clone, which this worktree shares a git directory with (cyril-9137f1ee, review of #202).
    run('npm', ['ci', '--ignore-scripts'], tree);
    run('npm', ['run', 'build:lib'], tree);
    const built = join(tree, 'dist');
    const builtFiles = listFiles(built);
    const hashes = new Map(
      builtFiles.map((f) => [f, sha256(readFileSync(join(built, f)))])
    );
    console.log(`rebuilt dist/: ${builtFiles.length} files`);
    return report('vendored files vs rebuild', compareToHashes(dir, hashes));
  } finally {
    // A failed cleanup leaves a stray worktree in the caller's clone: say so, without masking the result.
    const warnIfFailed = (what, r) => {
      if (r.status !== 0)
        console.log(
          `warning: ${what} failed (exit ${
            r.status ?? r.signal
          }); check \`git -C ${checkout} worktree list\``
        );
    };
    if (added)
      warnIfFailed(
        'removing the temporary worktree',
        spawnSync('git', [
          '-C',
          checkout,
          'worktree',
          'remove',
          '--force',
          tree,
        ])
      );
    rmSync(work, { recursive: true, force: true });
    warnIfFailed(
      'git worktree prune',
      spawnSync('git', ['-C', checkout, 'worktree', 'prune'])
    );
  }
}

function main(argv) {
  let dir = DEFAULT_DIR;
  let wantRebuild = false;
  let checkout = process.env.MIDST_FORMAT_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') {
      i += 1;
      if (!argv[i]) throw new UsageError('--dir needs a directory');
      dir = resolve(argv[i]);
    } else if (a === '--rebuild') {
      wantRebuild = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        i += 1;
        checkout = argv[i];
      }
    } else throw new UsageError(`unknown argument ${a}`);
  }
  if (!wantRebuild) return checkHashes(dir);
  if (!checkout)
    throw new UsageError(
      '--rebuild needs a midst-format checkout (argument or MIDST_FORMAT_ROOT)'
    );
  return rebuild(dir, resolve(checkout));
}

// realpath, because import.meta.url has links resolved and argv[1] does not: run through a link, a plain
// compare skips main() and exits 0 having checked nothing (cyril-9137f1ee, review of #202; midst-web #190).
// No argv[1] (imported, or run from a REPL) is the only "not main". Any other failure to resolve it is
// thrown, never read as "skip the check" (cyril-9137f1ee, review of #202).
const invokedAs = () =>
  process.argv[1] === undefined ? '' : realpathSync(process.argv[1]);
if (invokedAs() === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const ok = main(process.argv.slice(2));
    if (!ok) console.log('FAIL: vendored midst-format differs');
    else console.log('OK');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
}
