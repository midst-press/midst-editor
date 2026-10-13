/**
 * @jest-environment node
 */
// tools/package_run.cjs (issue #82): which package run a release promotes when run_id is blank.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chooseLatest } = require('../package_run.cjs');

const SCRIPT = path.join(__dirname, '..', 'package_run.cjs');
const PKG = '.github/workflows/package.yml';

describe('chooseLatest', () => {
  const r = (id, version) => ({ id, version, created_at: `t${id}` });
  it('takes the latest run when it is the only candidate at its version', () => {
    expect(chooseLatest([r(3, '0.2.1')], () => 4).id).toBe(3);
  });
  it('ignores an earlier run at the same version whose artifacts are gone', () => {
    const live = (id) => (id === 3 ? 4 : 0);
    expect(chooseLatest([r(3, '0.2.1'), r(2, '0.2.1')], live).id).toBe(3);
  });
  it('refuses when two runs at the same version still have artifacts, naming both', () => {
    expect(() => chooseLatest([r(3, '0.2.1'), r(2, '0.2.1')], () => 4)).toThrow(
      '2 package runs on main are candidates for 0.2.1: 3 (built t3), 2 (built t2)'
    );
  });
  it('refuses when there is no run', () => {
    expect(() => chooseLatest([], () => 0)).toThrow(
      'no successful package run on main'
    );
  });
});

describe('the command line, against a stub gh', () => {
  let dir;
  // The stub reads fixture.json: runs (as the list endpoint returns them), versions by commit, and live
  // artifact counts by run. STUB_FAIL makes any call whose arguments contain it fail.
  const STUB = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2).join(' ');
fs.appendFileSync(process.env.STUB_DIR + '/calls', args + '\\n');
if (process.env.STUB_FAIL && args.includes(process.env.STUB_FAIL)) { console.error('HTTP 502'); process.exit(1); }
const f = JSON.parse(fs.readFileSync(process.env.STUB_DIR + '/fixture.json', 'utf8'));
let m;
if (args.includes('/workflows/package.yml/runs')) f.runs.forEach((r) => console.log(JSON.stringify(r)));
else if ((m = args.match(/contents\\/release\\/app\\/package.json\\?ref=(\\w+)/)))
  console.log(JSON.stringify({ content: Buffer.from(JSON.stringify({ version: f.versions[m[1]] })).toString('base64') }));
else if ((m = args.match(/actions\\/runs\\/(\\d+)\\/artifacts/)))
  console.log(JSON.stringify({ artifacts: Array.from({ length: f.live[m[1]] || 0 }, () => ({ expired: false })) }));
else if ((m = args.match(/actions\\/runs\\/(\\d+)$/))) console.log(JSON.stringify(f.runs.find((r) => String(r.id) === m[1])));
else process.exit(1);
`;
  const run = (id, sha, extra = {}) => ({
    id,
    head_sha: sha,
    path: PKG,
    head_branch: 'main',
    conclusion: 'success',
    created_at: `2026-10-1${id % 10}T00:00:00Z`,
    html_url: `https://example.invalid/runs/${id}`,
    ...extra,
  });
  const fixture = (f) =>
    fs.writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify(f));
  const cli = (args, env = {}) =>
    spawnSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GH: path.join(dir, 'gh'), STUB_DIR: dir, ...env },
    });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgrun-'));
    fs.writeFileSync(path.join(dir, 'gh'), STUB);
    fs.chmodSync(path.join(dir, 'gh'), 0o755);
    fixture({
      // Newest is 400, on a branch; 300 failed. 200 is the only live 0.2.1 candidate on main; 100 is 0.2.0.
      runs: [
        run(400, 'd', { head_branch: 'feature' }),
        run(300, 'c', { conclusion: 'failure' }),
        run(200, 'b'),
        run(100, 'a'),
      ],
      versions: { a: '0.2.0', b: '0.2.1', c: '0.2.1', d: '0.2.1' },
      live: { 100: 4, 200: 4, 300: 4, 400: 4 },
    });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('blank: chooses the latest successful run on main and states it in the summary', () => {
    const summary = path.join(dir, 'summary.md');
    const r = cli(['--repo', 'o/r', '--run', '', '--summary', summary]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('RUN_ID=200\n');
    const text = fs.readFileSync(summary, 'utf8');
    expect(text).toContain(
      '### Releasing package run 200 (latest on main, chosen because run_id was blank)'
    );
    expect(text).toContain('- version 0.2.1');
    expect(text).toContain('- commit `b`');
  });

  it('blank: refuses when another run on main at that version still has artifacts', () => {
    const f = JSON.parse(
      fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8')
    );
    f.runs.push(run(150, 'b2'));
    f.versions.b2 = '0.2.1';
    f.live[150] = 4;
    fixture(f);
    const r = cli(['--repo', 'o/r', '--run', '']);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(
      '2 package runs on main are candidates for 0.2.1: 200'
    );
  });

  it('a given run is used as given, and stated', () => {
    const r = cli(['--repo', 'o/r', '--run', '100']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('RUN_ID=100\n');
    expect(r.stderr).toContain('### Releasing package run 100 (given)');
    expect(r.stderr).toContain('- version 0.2.0');
  });

  it('a failed API call exits 3 with no RUN_ID', () => {
    const r = cli(['--repo', 'o/r', '--run', ''], { STUB_FAIL: 'contents' });
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
  });

  it('refuses a malformed run id before calling gh', () => {
    expect(cli(['--repo', 'o/r', '--run', '12x']).status).toBe(2);
    expect(fs.existsSync(path.join(dir, 'calls'))).toBe(false);
  });
});
