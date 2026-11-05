/**
 * @jest-environment node
 */
// The built-package checks must fail CLOSED (alden-ec2221c7, #404): an awk that errors, or a find
// that lists only part of the tree and exits 1, is "could not tell" (exit 2), never "clean". Each
// failure is injected with a stand-in earlier on PATH, against a real stub package on which the
// unmodified check gives a verdict (0 or 1), so an exit 2 here can only come from the injection.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOOLS = path.join(__dirname, '..');
const CHECKS = [
  'check_pkg_not_version_checked.sh',
  'check_pkg_scripts_listed_once.sh',
];
const describeOnMac = process.platform === 'darwin' ? describe : describe.skip;

describeOnMac('built-package checks fail closed', () => {
  let work;
  let pkg;

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-fail-closed-'));
    const contents = path.join(work, 'root', 'Stub.app', 'Contents');
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.writeFileSync(
      path.join(contents, 'Info.plist'),
      '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>' +
        '<key>CFBundleIdentifier</key><string>invalid.example.fail-closed</string>' +
        '<key>CFBundleShortVersionString</key><string>0.0.1</string>' +
        '<key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n'
    );
    pkg = path.join(work, 'stub.pkg');
    const built = spawnSync(
      'pkgbuild',
      [
        '--root',
        path.join(work, 'root'),
        '--identifier',
        'invalid.example.fail-closed',
        '--install-location',
        '/Applications',
        pkg,
      ],
      { encoding: 'utf8' }
    );
    if (built.status !== 0) throw new Error(`pkgbuild failed: ${built.stderr}`);
  });

  // A bin directory holding one stand-in, put first on PATH.
  function standIn(name, body) {
    const bin = fs.mkdtempSync(path.join(work, `bin-${name}-`));
    fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, {
      mode: 0o755,
    });
    return bin;
  }

  const run = (check, bin) =>
    spawnSync('/bin/bash', [path.join(TOOLS, check), pkg], {
      encoding: 'utf8',
      env: { PATH: bin ? `${bin}:${process.env.PATH}` : process.env.PATH },
    });

  test.each(CHECKS)(
    '%s gives a verdict on the stub package unmodified',
    (check) => {
      expect([0, 1]).toContain(run(check).status);
    }
  );

  test.each(CHECKS)(
    '%s: an awk that errors gives 2, not a verdict',
    (check) => {
      const r = run(
        check,
        standIn('awk', 'echo "awk: injected failure" >&2; exit 2')
      );
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/awk failed/);
    }
  );

  test.each(CHECKS)(
    '%s: a find that lists part of the tree and exits 1 gives 2',
    (check) => {
      const r = run(
        check,
        standIn('find', '/usr/bin/find "$@" | head -n 1; exit 1')
      );
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/find failed/);
    }
  );
});
