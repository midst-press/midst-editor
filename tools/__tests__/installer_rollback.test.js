/**
 * @jest-environment node
 */
// Issue 16, rollback (Stuart's design, contract from cora-2f1e43dc, 4 Nov): if the new Midst is not
// in place after the payload, every app the preinstall moved aside goes back to its own name, and
// nothing is ever deleted. Three scripts take part, each run here against a fixture Applications folder:
//   installer/pkg-scripts/preinstall        moves each Midst aside; writes $record, $record.restore, $record.done
//   installer/pkg-scripts/postinstall       checks the new app; restores on failure; writes .installed or .restored
//   installer/remove-previous/postinstall   the opt-in delete; refuses unless .installed matches Midst.app
// The app component's scripts are copied into a temporary Scripts directory with an expected-version
// file beside them, as the package holds them. These are written before the code, so until it lands
// they fail.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PKG_SCRIPTS = path.join(ROOT, 'installer', 'pkg-scripts');
const REMOVE = path.join(ROOT, 'installer', 'remove-previous', 'postinstall');
const describeOnMac = process.platform === 'darwin' ? describe : describe.skip;

const ID = 'press.Midst.MidstApp';
const NEW = '0.9.5';
const OLD = '0.9.4';

function plist(info) {
  const entries = Object.entries(info)
    .map(([k, v]) => `<key>${k}</key><string>${v}</string>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    `<plist version="1.0"><dict>${entries}</dict></plist>\n`
  );
}

const ours = (version) => ({
  CFBundleIdentifier: ID,
  CFBundleShortVersionString: version,
});

function writeApp(applications, name, info) {
  const contents = path.join(applications, name, 'Contents');
  fs.mkdirSync(contents, { recursive: true });
  if (info) fs.writeFileSync(path.join(contents, 'Info.plist'), plist(info));
}

function versionOf(applications, name) {
  const file = path.join(applications, name, 'Contents', 'Info.plist');
  if (!fs.existsSync(file)) return null;
  return /CFBundleShortVersionString<\/key><string>([^<]*)</.exec(
    fs.readFileSync(file, 'utf8')
  )[1];
}

// A fixture volume, and a Scripts directory holding the app component's scripts and expected-version.
function setup(apps, expected = NEW) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-rollback-'));
  const applications = path.join(root, 'Applications');
  fs.mkdirSync(applications);
  Object.entries(apps).forEach(([name, info]) =>
    writeApp(applications, name, info)
  );
  const scripts = path.join(root, 'Scripts');
  fs.mkdirSync(scripts);
  ['preinstall', 'postinstall'].forEach((s) => {
    const to = path.join(scripts, s);
    if (fs.existsSync(path.join(PKG_SCRIPTS, s))) {
      fs.copyFileSync(path.join(PKG_SCRIPTS, s), to);
      fs.chmodSync(to, 0o755);
    }
  });
  if (expected !== null)
    fs.writeFileSync(path.join(scripts, 'expected-version'), expected);
  return { root, applications, scripts, record: path.join(root, 'record') };
}

function run(script, v) {
  return spawnSync(
    '/bin/bash',
    [script, '/x/Midst.pkg', '/Applications', v.root],
    {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, MIDST_PREVIOUS_RECORD: v.record },
    }
  );
}

const preinstall = (v) => run(path.join(v.scripts, 'preinstall'), v);
const postinstall = (v) => run(path.join(v.scripts, 'postinstall'), v);
const listing = (v) => fs.readdirSync(v.applications).sort();
const lines = (file) =>
  fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    : [];
const appCount = (v) => listing(v).filter((n) => n.endsWith('.app')).length;

// The payload: what the installer writes after the preinstall, when it writes anything.
const payload = (v, info = ours(NEW)) =>
  writeApp(v.applications, 'Midst.app', info);

describeOnMac('preinstall: what it records for a rollback', () => {
  test('one "<original name><TAB><kept path>" line per app it moves, and .done last', () => {
    const v = setup({
      'Midst Beta.app': ours('0.0.3'),
      'Midst.app': ours(OLD),
    });
    const r = preinstall(v);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(lines(`${v.record}.restore`)).toEqual([
      `Midst Beta.app\t${path.join(v.applications, 'Midst Beta 0.0.3.app')}`,
      `Midst.app\t${path.join(v.applications, `Midst ${OLD}.app`)}`,
    ]);
    expect(lines(v.record)).toEqual([
      path.join(v.applications, 'Midst Beta 0.0.3.app'),
      path.join(v.applications, `Midst ${OLD}.app`),
    ]);
    expect(fs.existsSync(`${v.record}.done`)).toBe(true);
  });

  // Beta moves, then Midst.app finds all 99 of its names taken: the preinstall puts Beta back itself,
  // because no postinstall runs after a preinstall that fails.
  test('a preinstall that fails part-way moves back what it moved, and deletes nothing', () => {
    const taken = Object.fromEntries(
      [
        `Midst ${OLD}.app`,
        ...Array.from({ length: 98 }, (_, i) => `Midst ${OLD} (${i + 2}).app`),
      ].map((n) => [n, {}])
    );
    const v = setup({
      ...taken,
      'Midst Beta.app': ours('0.0.3'),
      'Midst.app': ours(OLD),
    });
    const before = listing(v);
    const r = preinstall(v);
    expect(r.status).toBe(1);
    expect(listing(v)).toEqual(before);
    expect(versionOf(v.applications, 'Midst Beta.app')).toBe('0.0.3');
    expect(versionOf(v.applications, 'Midst.app')).toBe(OLD);
    expect(fs.existsSync(`${v.record}.done`)).toBe(false);
  });
});

describeOnMac('postinstall: the new Midst is in place', () => {
  test('passes, records the version, keeps the old copy, and a ticked delete removes only that copy', () => {
    const v = setup({ 'Midst.app': ours(OLD) });
    expect(preinstall(v).status).toBe(0);
    payload(v);
    const r = postinstall(v);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(fs.readFileSync(`${v.record}.installed`, 'utf8')).toBe(NEW);
    expect(listing(v)).toEqual([`Midst ${OLD}.app`, 'Midst.app']);
    const del = run(REMOVE, v);
    expect(del.stderr).toBe('');
    expect(del.status).toBe(0);
    expect(listing(v)).toEqual(['Midst.app']);
    expect(versionOf(v.applications, 'Midst.app')).toBe(NEW);
  });

  test('run twice, the second run changes nothing', () => {
    const v = setup({ 'Midst.app': ours(OLD) });
    preinstall(v);
    payload(v);
    expect(postinstall(v).status).toBe(0);
    const after = listing(v);
    const again = postinstall(v);
    expect(again.status).toBe(0);
    expect(listing(v)).toEqual(after);
    expect(fs.readFileSync(`${v.record}.installed`, 'utf8')).toBe(NEW);
  });
});

describeOnMac(
  'postinstall: the new Midst is not in place, so everything goes back',
  () => {
    // The 0.9.4 shape: the preinstall moved the newer Midst aside, and the payload wrote nothing.
    test('Midst.app missing: each kept app moves back to its own name, exit 1, nothing deleted', () => {
      const v = setup({
        'Midst Beta.app': ours('0.0.3'),
        'Midst.app': ours('99.0.0'),
      });
      expect(preinstall(v).status).toBe(0);
      const r = postinstall(v);
      expect(r.status).toBe(1);
      expect(listing(v)).toEqual(['Midst Beta.app', 'Midst.app']);
      expect(versionOf(v.applications, 'Midst.app')).toBe('99.0.0');
      expect(versionOf(v.applications, 'Midst Beta.app')).toBe('0.0.3');
      expect(lines(`${v.record}.restored`)).toHaveLength(2);
      expect(fs.existsSync(`${v.record}.installed`)).toBe(false);
      expect(r.stderr).toMatch(/Midst\.app/);
    });

    test.each([
      ['the wrong version', ours('0.9.3')],
      [
        'another app',
        {
          CFBundleIdentifier: 'com.example.other',
          CFBundleShortVersionString: NEW,
        },
      ],
      ['no Info.plist', null],
      ['the expected version with a trailing newline', ours(`${NEW}\n`)],
    ])(
      'Midst.app present but %s: nothing moves onto it, both are named, exit 1',
      (_label, info) => {
        const v = setup({ 'Midst.app': ours(OLD) });
        expect(preinstall(v).status).toBe(0);
        payload(v, info);
        const before = listing(v);
        const r = postinstall(v);
        expect(r.status).toBe(1);
        expect(listing(v)).toEqual(before);
        expect(versionOf(v.applications, `Midst ${OLD}.app`)).toBe(OLD);
        expect(r.stderr).toContain(path.join(v.applications, 'Midst.app'));
        expect(r.stderr).toContain(
          path.join(v.applications, `Midst ${OLD}.app`)
        );
        expect(fs.existsSync(`${v.record}.installed`)).toBe(false);
      }
    );

    test('Midst.app a symlink to the right app: not accepted, nothing moves, exit 1', () => {
      const v = setup({ 'Midst.app': ours(OLD) });
      expect(preinstall(v).status).toBe(0);
      writeApp(v.root, 'Elsewhere.app', ours(NEW));
      fs.symlinkSync(
        path.join(v.root, 'Elsewhere.app'),
        path.join(v.applications, 'Midst.app')
      );
      const r = postinstall(v);
      expect(r.status).toBe(1);
      expect(
        fs.lstatSync(path.join(v.applications, 'Midst.app')).isSymbolicLink()
      ).toBe(true);
      expect(versionOf(v.applications, `Midst ${OLD}.app`)).toBe(OLD);
    });

    test('expected-version holding a trailing newline does not match', () => {
      const v = setup({ 'Midst.app': ours(OLD) }, `${NEW}\n`);
      expect(preinstall(v).status).toBe(0);
      payload(v);
      const r = postinstall(v);
      expect(r.status).toBe(1);
      expect(fs.existsSync(`${v.record}.installed`)).toBe(false);
    });

    test('expected-version missing: fails, nothing deleted', () => {
      const v = setup({ 'Midst.app': ours(OLD) }, null);
      expect(preinstall(v).status).toBe(0);
      payload(v);
      const count = appCount(v);
      const r = postinstall(v);
      expect(r.status).toBe(1);
      expect(appCount(v)).toBe(count);
      expect(fs.existsSync(`${v.record}.installed`)).toBe(false);
    });

    test('an original name that is no longer free: that app is not moved, the others are, exit 1', () => {
      const v = setup({
        'Midst Beta.app': ours('0.0.3'),
        'Midst.app': ours('99.0.0'),
      });
      expect(preinstall(v).status).toBe(0);
      writeApp(v.applications, 'Midst Beta.app', {
        CFBundleIdentifier: 'com.example.squatter',
        CFBundleShortVersionString: '1',
      });
      const r = postinstall(v);
      expect(r.status).toBe(1);
      expect(versionOf(v.applications, 'Midst.app')).toBe('99.0.0');
      expect(versionOf(v.applications, 'Midst Beta 0.0.3.app')).toBe('0.0.3');
      expect(versionOf(v.applications, 'Midst Beta.app')).toBe('1');
      expect(r.stderr).toContain(path.join(v.applications, 'Midst Beta.app'));
    });

    test('a second run after a restore moves nothing and says it was already restored', () => {
      const v = setup({ 'Midst.app': ours('99.0.0') });
      expect(preinstall(v).status).toBe(0);
      expect(postinstall(v).status).toBe(1);
      const after = listing(v);
      const again = postinstall(v);
      expect(again.status).toBe(1);
      expect(again.stderr).toMatch(/already restored in this install/);
      expect(listing(v)).toEqual(after);
    });
  }
);

describeOnMac(
  'remove-previous: deletes only after a postinstall that passed',
  () => {
    test('no .installed: refuses, deletes nothing', () => {
      const v = setup({ 'Midst.app': ours(OLD) });
      expect(preinstall(v).status).toBe(0);
      payload(v);
      const before = listing(v);
      const r = run(REMOVE, v);
      expect(r.status).toBe(1);
      expect(listing(v)).toEqual(before);
    });

    test('.installed naming another version than the Midst.app in place: refuses, deletes nothing', () => {
      const v = setup({ 'Midst.app': ours(OLD) });
      expect(preinstall(v).status).toBe(0);
      payload(v);
      expect(postinstall(v).status).toBe(0);
      payload(v, ours('0.9.6'));
      const before = listing(v);
      const r = run(REMOVE, v);
      expect(r.status).toBe(1);
      expect(listing(v)).toEqual(before);
    });
  }
);
