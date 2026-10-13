#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax -- a Node CLI that prints its report, over plain loops */
// After a release, frees Actions artifact storage (GitHub Free allows 500 MB per organisation, and one
// package run is about 254 MB). Two commands, run by release.yml as separate steps:
//
//   node tools/prune_artifacts.cjs verify --repo <owner/name> --tag <tag> --dir <dir>
//       Exits 0 only if release <tag> in <repo> carries every file in <dir>, by name and byte size.
//
//   node tools/prune_artifacts.cjs prune --repo <owner/name> --run <package run id> [--dry-run] [--summary <file>]
//       Deletes the artifacts of package run <run> and of every package run with a smaller id. Never a
//       newer run: it may be a candidate under test. --dry-run deletes nothing and reports the same list.
//       Each artifact (name, run, MB) is printed and, with --summary, appended to that file as a table.
//
// Release assets have no storage limit, so once the installers are on a release the artifacts are
// redundant. The workflow runs prune only after verify has passed. gh is the GitHub CLI; GH overrides it.
// Exit: 0 done; 1 refused (release incomplete, or the run is not a package run); 2 usage; 3 an API call failed.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PACKAGE_WORKFLOW = '.github/workflows/package.yml';

/** Problems with a release against the files it should carry: [] means every file is there at its size. */
function checkRelease(assets, files) {
  const byName = new Map(assets.map((a) => [a.name, a.size]));
  const problems = [];
  if (files.length === 0) problems.push('no files to check against');
  for (const f of files) {
    if (!byName.has(f.name)) problems.push(`${f.name} is not on the release`);
    else if (byName.get(f.name) !== f.size)
      problems.push(
        `${f.name} is ${byName.get(f.name)} bytes on the release, ${
          f.size
        } here`
      );
  }
  return problems;
}

/**
 * The artifacts to delete: those of package runs whose id is at most runId. Expired artifacts hold no storage
 * and are left alone. Throws if runId is not itself a package run, so a mistyped id deletes nothing.
 */
function selectArtifacts(runs, artifacts, runId) {
  const packageRuns = new Set(
    runs.filter((r) => r.path === PACKAGE_WORKFLOW).map((r) => r.id)
  );
  if (!packageRuns.has(runId))
    throw new Error(`run ${runId} is not a package run`);
  return artifacts.filter(
    (a) =>
      !a.expired &&
      a.workflow_run &&
      packageRuns.has(a.workflow_run.id) &&
      a.workflow_run.id <= runId
  );
}

const mb = (bytes) => (bytes / 1e6).toFixed(1);

function gh(args) {
  try {
    return execFileSync(process.env.GH || 'gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = new Error(
      `gh ${args.slice(0, 3).join(' ')} failed: ${(e.stderr || e.message)
        .toString()
        .trim()}`
    );
    err.api = true;
    throw err;
  }
}

/** Every item of a paginated list endpoint. --jq prints each item as one line of JSON. */
function list(endpoint, key) {
  return gh(['api', '--paginate', endpoint, '--jq', `.${key}[]`])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function verify({ repo, tag, dir }) {
  const files = fs
    .readdirSync(dir)
    .filter((n) => fs.statSync(path.join(dir, n)).isFile())
    .map((name) => ({ name, size: fs.statSync(path.join(dir, name)).size }));
  const release = JSON.parse(
    gh(['release', 'view', tag, '--repo', repo, '--json', 'assets'])
  );
  const problems = checkRelease(release.assets, files);
  if (problems.length) {
    problems.forEach((p) => console.error(`release ${tag} incomplete: ${p}`));
    return 1;
  }
  console.log(
    `release ${tag} carries all ${files.length} files at their sizes`
  );
  return 0;
}

function prune({ repo, run, dryRun, summary }) {
  const runs = list(
    `repos/${repo}/actions/workflows/package.yml/runs?per_page=100`,
    'workflow_runs'
  );
  const artifacts = list(
    `repos/${repo}/actions/artifacts?per_page=100`,
    'artifacts'
  );
  const chosen = selectArtifacts(runs, artifacts, run);
  const rows = [];
  for (const a of chosen) {
    if (!dryRun)
      gh(['api', '-X', 'DELETE', `repos/${repo}/actions/artifacts/${a.id}`]);
    rows.push(`| ${a.name} | ${a.workflow_run.id} | ${mb(a.size_in_bytes)} |`);
    console.log(
      `${dryRun ? 'would delete' : 'deleted'} ${a.name} (run ${
        a.workflow_run.id
      }, ${mb(a.size_in_bytes)} MB)`
    );
  }
  const total = mb(chosen.reduce((s, a) => s + a.size_in_bytes, 0));
  const line = `${dryRun ? 'would delete' : 'deleted'} ${
    chosen.length
  } artifact(s), ${total} MB, from package run ${run} and earlier`;
  console.log(line);
  if (summary) {
    const table = rows.length
      ? ['| artifact | run | MB |', '|---|---|---|', ...rows, '']
      : [];
    fs.appendFileSync(
      summary,
      `${[
        `### Artifacts ${dryRun ? '(dry run)' : 'deleted'}`,
        line,
        '',
        ...table,
      ].join('\n')}\n`
    );
  }
  return 0;
}

function usage(msg) {
  console.error(
    `${msg}\nusage: prune_artifacts.cjs verify --repo R --tag T --dir D | prune --repo R --run N [--dry-run] [--summary F]`
  );
  return 2;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = {};
  for (let i = 0; i < rest.length; i += 1) {
    const k = rest[i];
    if (k === '--dry-run') opt.dryRun = true;
    else if (
      ['--repo', '--tag', '--dir', '--run', '--summary'].includes(k) &&
      rest[i + 1] !== undefined
    )
      opt[k.slice(2)] = rest[(i += 1)];
    else return usage(`unknown argument ${k}`);
  }
  if (!opt.repo || !/^[\w.-]+\/[\w.-]+$/.test(opt.repo))
    return usage('--repo owner/name is required');
  try {
    if (cmd === 'verify') {
      if (!opt.tag || !opt.dir) return usage('verify needs --tag and --dir');
      return verify(opt);
    }
    if (cmd === 'prune') {
      if (!/^[0-9]+$/.test(opt.run || ''))
        return usage('prune needs --run <run id>');
      return prune({ ...opt, run: Number(opt.run) });
    }
  } catch (e) {
    console.error(e.message);
    return e.api ? 3 : 1;
  }
  return usage(`unknown command ${cmd}`);
}

module.exports = { checkRelease, selectArtifacts, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
