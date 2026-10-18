/**
 * @jest-environment node
 */
// tools/check-vendored-format.mjs. Every case runs the CLI on a copy of the real vendor directory in a temp
// dir, so the green baseline is the committed build and each failure is one injected fault.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'check-vendored-format.mjs');
const VENDOR = path.join(__dirname, '..', '..', 'vendor', 'midst-format');
const VENDORED_FILES = 13; // 3 entry points x (cjs, mjs, d.ts, package.json) + the top-level package.json

let tmp;
let dir;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vendored-'));
  dir = path.join(tmp, 'midst-format');
  fs.cpSync(VENDOR, dir, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const check = (args = [], env = {}) => {
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MIDST_FORMAT_ROOT: '', ...env },
  });
  return { status: r.status, out: r.stdout + r.stderr };
};
const checkDir = () => check(['--dir', dir]);

describe('default mode', () => {
  it('passes on the committed build, and says how many files it examined', () => {
    const r = checkDir();
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      `${VENDORED_FILES} files examined, 0 changed, 0 missing, 0 extra`
    );
  });

  it('fails when one byte of a vendored file changes, naming the file and not its content', () => {
    const file = path.join(dir, 'history', 'index.cjs');
    const bytes = fs.readFileSync(file);
    bytes[0] = (bytes[0] + 1) % 256;
    fs.writeFileSync(file, bytes);
    const r = checkDir();
    expect(r.status).toBe(1);
    expect(r.out).toContain('1 changed, 0 missing, 0 extra');
    expect(r.out).toContain('changed: history/index.cjs');
    expect(r.out).not.toContain(bytes.toString('utf8', 0, 20));
  });

  it('fails on an extra file', () => {
    fs.writeFileSync(path.join(dir, 'convert', 'extra.js'), 'x');
    const r = checkDir();
    expect(r.status).toBe(1);
    expect(r.out).toContain('0 changed, 0 missing, 1 extra');
    expect(r.out).toContain('extra: convert/extra.js');
  });

  it('fails on a missing file', () => {
    fs.rmSync(path.join(dir, 'extensions', 'index.mjs'));
    const r = checkDir();
    expect(r.status).toBe(1);
    expect(r.out).toContain('0 changed, 1 missing, 0 extra');
    expect(r.out).toContain('missing: extensions/index.mjs');
  });

  it('does not count VENDOR.md itself as an extra file', () => {
    fs.appendFileSync(path.join(dir, 'VENDOR.md'), '\nnote\n');
    expect(checkDir().status).toBe(0);
  });

  it('refuses a VENDOR.md with no hash block rather than passing on nothing', () => {
    fs.writeFileSync(
      path.join(dir, 'VENDOR.md'),
      '- Tag: `v0.2.0`\n- Commit: `abc`\n'
    );
    const r = checkDir();
    expect(r.status).toBe(2);
    expect(r.out).toContain('no sha256 block');
  });

  it('refuses an empty hash block', () => {
    fs.writeFileSync(
      path.join(dir, 'VENDOR.md'),
      '- Tag: `v0.2.0`\n- Commit: `abc`\n```sha256\n```\n'
    );
    const r = checkDir();
    expect(r.status).toBe(2);
    expect(r.out).toContain('hash block is empty');
  });

  it('run through a symbolic link, still checks: a changed file fails (cyril-9137f1ee, review of #202)', () => {
    const linked = path.join(tmp, 'linked-tools');
    fs.symlinkSync(path.dirname(SCRIPT), linked);
    fs.appendFileSync(path.join(dir, 'history', 'index.cjs'), '\n');
    const r = spawnSync(
      'node',
      [path.join(linked, path.basename(SCRIPT)), '--dir', dir],
      { encoding: 'utf8', env: { ...process.env, MIDST_FORMAT_ROOT: '' } }
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('changed: history/index.cjs');
  });

  it('refuses a directory that does not exist', () => {
    expect(check(['--dir', path.join(tmp, 'nope')]).status).toBe(2);
  });
});

describe('--rebuild', () => {
  const git = (cwd, ...args) =>
    spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

  it('refuses with no checkout argument and no MIDST_FORMAT_ROOT', () => {
    const r = check(['--dir', dir, '--rebuild']);
    expect(r.status).toBe(2);
    expect(r.out).toContain('MIDST_FORMAT_ROOT');
  });

  it('fails before building when the tag resolves to a different commit than VENDOR.md records', () => {
    const repo = path.join(tmp, 'format');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    git(
      repo,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'x'
    );
    git(repo, 'tag', 'v0.2.0');
    const via = (args, env) => check(['--dir', dir, '--rebuild', ...args], env);
    [via([repo]), via([], { MIDST_FORMAT_ROOT: repo })].forEach((r) => {
      expect(r.status).toBe(1);
      expect(r.out).toContain('does not resolve to the recorded commit');
      expect(r.out).not.toContain('rebuilt dist/');
    });
  });

  it('refuses a checkout without the tag', () => {
    const repo = path.join(tmp, 'format');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    const r = check(['--dir', dir, '--rebuild', repo]);
    expect(r.status).toBe(2);
  });
});
