#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax -- a Node CLI that prints its report, over plain loops */
// Chooses the package run release.yml promotes (#82), and says which one before anything is tagged.
//
//   node tools/package_run.cjs --repo <owner/name> [--run <id>] [--summary <file>]
//
// With --run, that run. Without it, the most recent successful package run on main, unless another
// successful package run on main at the same version still has artifacts: then it refuses and lists them,
// because the latest build is not necessarily the one that was tested, and only a person knows which was.
// Prints RUN_ID=<id> on stdout (for $GITHUB_ENV); the run's number, commit, version and build time go to
// stderr and, with --summary, to that file. Everything else about the run is checked by release.yml.
// Exit: 0 chosen; 1 refused; 2 usage; 3 an API call failed. gh is the GitHub CLI; GH overrides it.

const { execFileSync } = require('child_process');
const fs = require('fs');

const PACKAGE_WORKFLOW = '.github/workflows/package.yml';

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

const json = (args) => JSON.parse(gh(args));

/** The version release/app/package.json states at a commit. */
function versionAt(repo, sha) {
  const { content } = json([
    'api',
    `repos/${repo}/contents/release/app/package.json?ref=${sha}`,
  ]);
  return JSON.parse(Buffer.from(content, 'base64').toString('utf8')).version;
}

const liveArtifacts = (repo, id) =>
  json([
    'api',
    `repos/${repo}/actions/runs/${id}/artifacts?per_page=100`,
  ]).artifacts.filter((a) => !a.expired).length;

/**
 * runs: successful package runs on main, newest first, each with its version; live: run id -> unexpired
 * artifact count. Returns the run to release, or throws naming every candidate when the latest is ambiguous.
 */
function chooseLatest(runs, live) {
  if (runs.length === 0) throw new Error('no successful package run on main');
  const [latest] = runs;
  const sameVersion = runs.filter(
    (r) => r.version === latest.version && live(r.id) > 0
  );
  if (sameVersion.length > 1) {
    const list = sameVersion
      .map((r) => `${r.id} (built ${r.created_at})`)
      .join(', ');
    throw new Error(
      `${sameVersion.length} package runs on main are candidates for ${latest.version}: ${list}. ` +
        'Give run_id the number of the one that was tested.'
    );
  }
  return latest;
}

function usage(msg) {
  console.error(
    `${msg}\nusage: package_run.cjs --repo <owner/name> [--run <id>] [--summary <file>]`
  );
  return 2;
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (
      ['--repo', '--run', '--summary'].includes(k) &&
      argv[i + 1] !== undefined
    )
      opt[k.slice(2)] = argv[(i += 1)];
    else return usage(`unknown argument ${k}`);
  }
  if (!opt.repo || !/^[\w.-]+\/[\w.-]+$/.test(opt.repo))
    return usage('--repo owner/name is required');
  if (opt.run !== undefined && opt.run !== '' && !/^[0-9]+$/.test(opt.run))
    return usage(`--run must be a run's number, got: ${opt.run}`);
  try {
    let run;
    if (opt.run) {
      run = json(['api', `repos/${opt.repo}/actions/runs/${opt.run}`]);
      run.version =
        run.path === PACKAGE_WORKFLOW
          ? versionAt(opt.repo, run.head_sha)
          : '(not a package run)';
    } else {
      const versions = new Map();
      const runs = gh([
        'api',
        '--paginate',
        `repos/${opt.repo}/actions/workflows/package.yml/runs?branch=main&status=success&per_page=100`,
        '--jq',
        '.workflow_runs[]',
      ])
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter(
          (r) =>
            r.path === PACKAGE_WORKFLOW &&
            r.head_branch === 'main' &&
            r.conclusion === 'success'
        )
        .sort((a, b) => b.id - a.id);
      // Versions are read only as far as the latest version reaches, newest first.
      const withVersions = [];
      for (const r of runs) {
        if (!versions.has(r.head_sha))
          versions.set(r.head_sha, versionAt(opt.repo, r.head_sha));
        r.version = versions.get(r.head_sha);
        if (withVersions.length && r.version !== withVersions[0].version) break;
        withVersions.push(r);
      }
      run = chooseLatest(withVersions, (id) => liveArtifacts(opt.repo, id));
    }
    const how = opt.run
      ? 'given'
      : 'latest on main, chosen because run_id was blank';
    const lines = [
      `### Releasing package run ${run.id} (${how})`,
      `- commit \`${run.head_sha}\``,
      `- version ${run.version}`,
      `- built ${run.created_at}`,
      `- ${run.html_url}`,
      '',
    ];
    console.error(lines.join('\n'));
    if (opt.summary) fs.appendFileSync(opt.summary, `${lines.join('\n')}\n`);
    console.log(`RUN_ID=${run.id}`);
    return 0;
  } catch (e) {
    console.error(e.message);
    return e.api ? 3 : 1;
  }
}

module.exports = { chooseLatest, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
