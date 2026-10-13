/**
 * @jest-environment node
 */
// tools/prune_artifacts.cjs (issue #69). The CLI runs against a stub gh that serves fixture lists and logs
// every call, so the tests can see exactly what would have been deleted.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkRelease, selectArtifacts } = require('../prune_artifacts.cjs');

const SCRIPT = path.join(__dirname, '..', 'prune_artifacts.cjs');
const PKG = '.github/workflows/package.yml';
const run = (id) => ({ id, path: PKG });
const art = (id, runId, extra = {}) => ({
  id,
  name: `a${id}`,
  size_in_bytes: 87e6,
  expired: false,
  workflow_run: { id: runId },
  ...extra,
});

describe('checkRelease', () => {
  const files = [
    { name: 'Midst-0.2.1-arm64.pkg', size: 10 },
    { name: 'SHA256SUMS', size: 3 },
  ];
  it('passes when every file is on the release at its size', () => {
    expect(checkRelease([...files, { name: 'extra', size: 1 }], files)).toEqual(
      []
    );
  });
  it('names a missing file and a size that differs', () => {
    expect(checkRelease([{ name: 'SHA256SUMS', size: 4 }], files)).toEqual([
      'Midst-0.2.1-arm64.pkg is not on the release',
      'SHA256SUMS is 4 bytes on the release, 3 here',
    ]);
  });
  it('refuses an empty list rather than passing it', () => {
    expect(checkRelease([], [])).toEqual(['no files to check against']);
  });
});

describe('selectArtifacts', () => {
  const runs = [run(10), run(20), run(30)];
  it('takes the released run and earlier ones, never a newer run', () => {
    const arts = [art(1, 10), art(2, 20), art(3, 30)];
    expect(selectArtifacts(runs, arts, 20).map((a) => a.id)).toEqual([1, 2]);
  });
  it('leaves other workflows, expired artifacts and artifacts without a run alone', () => {
    const arts = [
      art(1, 5),
      art(2, 10, { expired: true }),
      art(3, 10, { workflow_run: null }),
      art(4, 10),
    ];
    expect(selectArtifacts(runs, arts, 30).map((a) => a.id)).toEqual([4]);
  });
  it('refuses a run that is not a package run', () => {
    expect(() => selectArtifacts(runs, [art(1, 10)], 25)).toThrow(
      'run 25 is not a package run'
    );
  });
});

describe('the command line, against a stub gh', () => {
  let dir;
  const STUB = `#!/bin/bash
echo "$*" >> "$STUB_DIR/calls"
[ -n "$STUB_FAIL" ] && case "$*" in *"$STUB_FAIL"*) echo "HTTP 502" >&2; exit 1 ;; esac
case "$1 $2" in
  "api --paginate") case "$3" in
      */workflows/package.yml/runs*) cat "$STUB_DIR/runs.jsonl" ;;
      */actions/artifacts*) cat "$STUB_DIR/artifacts.jsonl" ;;
      *) exit 1 ;; esac ;;
  "api -X") exit 0 ;;
  "release view") cat "$STUB_DIR/release.json" ;;
  *) exit 1 ;;
esac
`;
  const write = (name, items) =>
    fs.writeFileSync(
      path.join(dir, name),
      `${items.map((i) => JSON.stringify(i)).join('\n')}\n`
    );
  const cli = (args, env = {}) =>
    spawnSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GH: path.join(dir, 'gh'), STUB_DIR: dir, ...env },
    });
  const calls = () =>
    fs.existsSync(path.join(dir, 'calls'))
      ? fs.readFileSync(path.join(dir, 'calls'), 'utf8')
      : '';
  const deletes = () =>
    calls()
      .split('\n')
      .filter((c) => c.startsWith('api -X DELETE'));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
    fs.writeFileSync(path.join(dir, 'gh'), STUB);
    fs.chmodSync(path.join(dir, 'gh'), 0o755);
    write('runs.jsonl', [run(100), run(200), run(300)]);
    write('artifacts.jsonl', [
      art(1, 100),
      art(2, 200),
      art(3, 200),
      art(4, 300),
      art(5, 50),
    ]);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('prune deletes the released run and earlier ones, and reports each in the summary', () => {
    const summary = path.join(dir, 'summary.md');
    const r = cli([
      'prune',
      '--repo',
      'o/r',
      '--run',
      '200',
      '--summary',
      summary,
    ]);
    expect(r.status).toBe(0);
    expect(deletes()).toEqual([
      'api -X DELETE repos/o/r/actions/artifacts/1',
      'api -X DELETE repos/o/r/actions/artifacts/2',
      'api -X DELETE repos/o/r/actions/artifacts/3',
    ]);
    expect(fs.readFileSync(summary, 'utf8')).toContain('| a2 | 200 | 87.0 |');
    expect(r.stdout).toContain(
      'deleted 3 artifact(s), 261.0 MB, from package run 200 and earlier'
    );
  });

  it('--dry-run reports the same list and deletes nothing', () => {
    const r = cli(['prune', '--repo', 'o/r', '--run', '200', '--dry-run']);
    expect(r.status).toBe(0);
    expect(deletes()).toEqual([]);
    expect(r.stdout).toContain('would delete 3 artifact(s), 261.0 MB');
  });

  it('a run id that is not a package run deletes nothing', () => {
    const r = cli(['prune', '--repo', 'o/r', '--run', '250']);
    expect(r.status).toBe(1);
    expect(deletes()).toEqual([]);
  });

  it('a failed listing deletes nothing and exits 3', () => {
    const r = cli(['prune', '--repo', 'o/r', '--run', '200'], {
      STUB_FAIL: 'actions/artifacts',
    });
    expect(r.status).toBe(3);
    expect(deletes()).toEqual([]);
  });

  it('verify passes a complete release and refuses an incomplete one', () => {
    const files = path.join(dir, 'release');
    fs.mkdirSync(files);
    fs.writeFileSync(path.join(files, 'Midst.pkg'), '12345');
    fs.writeFileSync(path.join(files, 'SHA256SUMS'), 'ab');
    fs.writeFileSync(
      path.join(dir, 'release.json'),
      JSON.stringify({
        assets: [
          { name: 'Midst.pkg', size: 5 },
          { name: 'SHA256SUMS', size: 2 },
        ],
      })
    );
    expect(
      cli(['verify', '--repo', 'o/r', '--tag', 'v1', '--dir', files]).status
    ).toBe(0);
    fs.writeFileSync(
      path.join(dir, 'release.json'),
      JSON.stringify({ assets: [{ name: 'Midst.pkg', size: 4 }] })
    );
    const r = cli(['verify', '--repo', 'o/r', '--tag', 'v1', '--dir', files]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('SHA256SUMS is not on the release');
  });

  it('refuses bad arguments before calling gh', () => {
    expect(cli(['prune', '--repo', 'o/r', '--run', '2x']).status).toBe(2);
    expect(cli(['prune', '--repo', 'not a repo', '--run', '2']).status).toBe(2);
    expect(calls()).toBe('');
  });
});
