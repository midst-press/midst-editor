/**
 * @jest-environment node
 */
// tools/release/check_release_evidence.sh (#414), against the repo's own docs/releasing.md and evidence
// folders written into a temp dir.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(
  __dirname,
  '..',
  'release',
  'check_release_evidence.sh'
);
const DOC = path.join(__dirname, '..', '..', 'docs', 'releasing.md');
const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

// What the install-test section of releasing.md asks for, read the way a person would read it.
const section = fs
  .readFileSync(DOC, 'utf8')
  .split(/^## /m)
  .find((s) => s.startsWith('The macOS install test'));
const titles = [...section.matchAll(/^- \[ \] \*\*(.*?)\*\*/gm)].map(
  (m) => m[1]
);
const shots = [
  ...new Set(
    [...section.matchAll(/`([A-Za-z0-9._-]+\.png)`/g)].map((m) => m[1])
  ),
];

const goodLog = (sha = SHA) =>
  [
    `package   Midst-1.0.0-arm64.pkg sha256 ${sha}`,
    'ok    1 signed',
    'check_installed_package: previous release 0.9.4: PASSED',
    `check_installed_package: PASSED Midst-1.0.0-arm64.pkg sha256 ${sha}`,
    '',
  ].join('\n');
const goodManifest = (sha = SHA) =>
  [
    `sha256 ${sha}`,
    ...titles.map((t) => `- [x] **${t}** see the screenshots`),
    '',
  ].join('\n');

let dir;
const write = (name, content) =>
  fs.writeFileSync(path.join(dir, name), content);
const writeGood = () => {
  write('install-test.log', goodLog());
  write('manifest.txt', goodManifest());
  shots.forEach((s) => write(s, PNG));
};
const check = (evidence = dir, sha = SHA) => {
  const r = spawnSync('bash', [SCRIPT, evidence, sha, DOC], {
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout + r.stderr };
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-evidence-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

it('reads the checklist and the six screenshots from releasing.md', () => {
  expect(titles.length).toBeGreaterThan(0);
  expect(shots.sort()).toEqual(
    [
      'customize-delete-choice.png',
      'customize-no-midst.png',
      'poem-same-version.png',
      'poem-ticked.png',
      'poem-unticked.png',
      'warning-old-version.png',
    ].sort()
  );
});

it('passes complete evidence for this package', () => {
  writeGood();
  const r = check();
  expect(r.status).toBe(0);
  expect(r.out).toContain(SHA);
});

it('refuses a folder that does not exist', () => {
  expect(check(path.join(dir, 'v9.9.9')).status).toBe(1);
});

it('refuses when the log is missing', () => {
  writeGood();
  fs.rmSync(path.join(dir, 'install-test.log'));
  const r = check();
  expect(r.status).toBe(1);
  expect(r.out).toContain('install-test.log');
});

it('refuses a log that passed another package', () => {
  writeGood();
  write('install-test.log', goodLog(OTHER_SHA));
  const r = check();
  expect(r.status).toBe(1);
  expect(r.out).toContain(`PASSED line for sha256 ${SHA}`);
});

it('refuses a FAILED log for this package', () => {
  writeGood();
  write(
    'install-test.log',
    goodLog().replace(
      `check_installed_package: PASSED Midst-1.0.0-arm64.pkg sha256 ${SHA}`,
      `check_installed_package: FAILED Midst-1.0.0-arm64.pkg sha256 ${SHA}`
    )
  );
  const r = check();
  expect(r.status).toBe(1);
  expect(r.out).toContain(`PASSED line for sha256 ${SHA}`);
});

it('refuses a log without the previous-release case', () => {
  writeGood();
  write(
    'install-test.log',
    goodLog().replace(
      'check_installed_package: previous release 0.9.4: PASSED',
      'check_installed_package: previous release: not run'
    )
  );
  const r = check();
  expect(r.status).toBe(1);
  expect(r.out).toContain('previous release');
});

it('refuses a manifest for another package', () => {
  writeGood();
  write('manifest.txt', goodManifest(OTHER_SHA));
  const r = check();
  expect(r.status).toBe(1);
  expect(r.out).toContain(`sha256 ${SHA}`);
});

it('refuses an unticked checklist item and names it', () => {
  writeGood();
  const [first] = titles;
  write(
    'manifest.txt',
    goodManifest().replace(`- [x] **${first}**`, `- [ ] **${first}**`)
  );
  const r = check();
  expect(r.status).toBe(1);
  expect(r.out).toContain(`- [x] **${first}**`);
});

it('refuses a screenshot that is not a PNG, and one that is empty, naming both', () => {
  writeGood();
  write(shots[0], 'not an image');
  write(shots[1], '');
  const r = check();
  expect(r.status).toBe(1);
  expect(r.out).toContain(`${shots[0]} as a real PNG`);
  expect(r.out).toContain(shots[1]);
});

it('lists everything missing in one refusal', () => {
  write('manifest.txt', goodManifest());
  const r = check();
  expect(r.status).toBe(1);
  expect(r.out).toContain('install-test.log');
  shots.forEach((s) => expect(r.out).toContain(s));
});

it('cannot run on a sha that is not a sha256', () => {
  writeGood();
  expect(check(dir, 'abc').status).toBe(2);
});

// tools/release/release.sh, with gh, curl and git replaced by stubs on PATH: the release workflow is
// started only when the evidence attached to the release PR passes.
describe('release.sh', () => {
  const RELEASE = path.join(__dirname, '..', 'release', 'release.sh');
  let stub;
  const stubs = {
    gh: `#!/bin/bash
case "$1 $2" in
  "run view") echo "$STUB_COMMIT" ;;
  "run download") d=\${@: -1}; mkdir -p "$d/midst-macos-arm64" && cp "$STUB_PKG" "$d/midst-macos-arm64/Midst-1.0.0-arm64.pkg" ;;
  "workflow run") echo "$*" >> "$STUB_STARTED" ;;
  *) exit 9 ;;
esac`,
    curl: `#!/bin/bash
out= url=\${@: -1}
while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done
case "$url" in
  */assets) cp "$STUB_ASSETS" "$out"; printf 200 ;;
  *) cp "$STUB_EVIDENCE/\${url##*/}" "$out" ;;
esac`,
    git: `#!/bin/bash
case " $* " in
  *" fetch "*) exit 0 ;;
  *" show "*) cat "$STUB_DOC" ;;
  *) exit 9 ;;
esac`,
  };
  const pkgBytes = Buffer.from('a stand-in package');
  const pkgSha = crypto.createHash('sha256').update(pkgBytes).digest('hex');

  beforeEach(() => {
    stub = fs.mkdtempSync(path.join(os.tmpdir(), 'release-stub-'));
    fs.mkdirSync(path.join(stub, 'bin'));
    Object.entries(stubs).forEach(([name, body]) => {
      fs.writeFileSync(path.join(stub, 'bin', name), `${body}\n`, {
        mode: 0o755,
      });
    });
    fs.writeFileSync(path.join(stub, 'pkg'), pkgBytes);
  });
  afterEach(() => fs.rmSync(stub, { recursive: true, force: true }));

  // Attach what is in the evidence dir to the stand-in release PR, then run release.sh.
  const release = () => {
    const names = fs.readdirSync(dir);
    fs.writeFileSync(
      path.join(stub, 'assets.json'),
      JSON.stringify(
        names.map((n) => ({
          name: n,
          browser_download_url: `http://gitea.invalid/attachments/${n}`,
        }))
      )
    );
    const r = spawnSync('bash', [RELEASE, '123', '45'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(stub, 'bin')}:${process.env.PATH}`,
        GITEA_TOKEN: 'stand-in',
        STUB_COMMIT: 'c'.repeat(40),
        STUB_PKG: path.join(stub, 'pkg'),
        STUB_STARTED: path.join(stub, 'started'),
        STUB_ASSETS: path.join(stub, 'assets.json'),
        STUB_EVIDENCE: dir,
        STUB_DOC: DOC,
      },
    });
    const started = fs.existsSync(path.join(stub, 'started'))
      ? fs.readFileSync(path.join(stub, 'started'), 'utf8')
      : '';
    return { status: r.status, out: r.stdout + r.stderr, started };
  };
  const attachGood = () => {
    write('install-test.log', goodLog(pkgSha));
    write('manifest.txt', goodManifest(pkgSha));
    shots.forEach((s) => write(s, PNG));
  };

  it('starts the release workflow when the evidence for this package is attached', () => {
    attachGood();
    const r = release();
    expect(r.status).toBe(0);
    expect(r.started).toContain('run_id=123');
  });

  it('does not start it when a screenshot is missing', () => {
    attachGood();
    fs.rmSync(path.join(dir, shots[0]));
    const r = release();
    expect(r.status).toBe(1);
    expect(r.out).toContain(shots[0]);
    expect(r.started).toBe('');
  });

  it('does not start it when the evidence is for another package', () => {
    write('install-test.log', goodLog(OTHER_SHA));
    write('manifest.txt', goodManifest(OTHER_SHA));
    shots.forEach((s) => write(s, PNG));
    const r = release();
    expect(r.status).toBe(1);
    expect(r.started).toBe('');
  });
});
