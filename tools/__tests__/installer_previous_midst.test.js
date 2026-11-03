/**
 * @jest-environment jsdom
 */
// Issue 16: the macOS installer keeps any Midst already installed, renamed with its version
// ("Midst 0.9.3", "Midst Beta 0.0.3"), and deletes it only when the poet opts in. Three pieces decide or act on "older Midst", and each is run here
// against the same on-disk Applications folders:
//   installer/previous-midst-check.js      the installer's warning (any platform: stubbed Installer API)
//   installer/pkg-scripts/preinstall        the rename (macOS: it reads Info.plist with plutil)
//   installer/remove-previous/postinstall   the opt-in delete (macOS)
// and tools/installer_distribution.cjs, which wires the first and third into the package.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const {
  editDistribution,
  REMOVE_ID,
  CHECK_JS,
} = require('../installer_distribution.cjs');

const ROOT = path.join(__dirname, '..', '..');
const PREINSTALL = path.join(ROOT, 'installer', 'pkg-scripts', 'preinstall');
const REMOVE = path.join(ROOT, 'installer', 'remove-previous', 'postinstall');
const ON_MAC = process.platform === 'darwin';
// The shell scripts need plutil, which only macOS has. Elsewhere they are reported as skipped,
// by name; the Gitea CI runs this suite on macOS, where they run.
const describeOnMac = ON_MAC ? describe : describe.skip;

const OURS = {
  CFBundleIdentifier: 'press.Midst.MidstApp',
  CFBundleShortVersionString: '0.2.1',
};
const ORIGINAL = {
  CFBundleIdentifier: 'press.Midst.MidstApp',
  CFBundleShortVersionString: '0.0.5',
};

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

// apps: { "Midst.app": info | null (no Info.plist) }
function volume(apps) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-installer-'));
  const applications = path.join(root, 'Applications');
  fs.mkdirSync(applications);
  Object.entries(apps).forEach(([name, info]) => {
    const contents = path.join(applications, name, 'Contents');
    fs.mkdirSync(contents, { recursive: true });
    if (info) fs.writeFileSync(path.join(contents, 'Info.plist'), plist(info));
  });
  return { root, applications, record: path.join(root, 'record') };
}

function listing(dir) {
  return fs.readdirSync(dir).sort();
}

// The installer script in a context shaped like macOS Installer's, with /Applications mapped onto
// the fixture. bundleAtPath returns the Info.plist's strings, or null when there is none.
function installerCheck(applications) {
  const at = (p) => p.replace(/^\/Applications/, applications);
  const result = {};
  const context = {
    my: { result },
    system: {
      files: {
        fileExistsAtPath: (p) => fs.existsSync(at(p)),
        bundleAtPath: (p) => {
          const file = path.join(at(p), 'Contents', 'Info.plist');
          if (!fs.existsSync(file)) return null;
          const info = {};
          const xml = fs.readFileSync(file, 'utf8');
          Array.from(
            xml.matchAll(/<key>([^<]*)<\/key><string>([^<]*)<\/string>/g)
          ).forEach(([, key, value]) => {
            info[key] = value;
          });
          return info;
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(CHECK_JS, 'utf8'), context);
  const passed = vm.runInContext('midstPreviousCheck()', context);
  return {
    passed,
    result,
    visible: vm.runInContext('midstHasPrevious()', context),
    labels: vm.runInContext('midstPreviousApps().map(midstLabel)', context),
  };
}

function run(script, v, extraEnv = {}) {
  return spawnSync(
    '/bin/bash',
    [script, '/x/Midst.pkg', '/Applications', v.root],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        MIDST_PREVIOUS_RECORD: v.record,
        ...extraEnv,
      },
    }
  );
}

// What is in Applications before, and what the preinstall should leave there. "warn" is the
// installer check's answer, which must agree with whether anything is kept.
// Every Midst already in Applications is kept, whatever its id or version, ours included and the
// same version as the one being installed included: nothing is written over without the poet's say
// (#16, GitHub #47; Stuart, 4 Nov: the most conservative reading wherever data safety is a judgement call).
// A kept app is named with its version: "Midst <v>.app", "Midst Beta <v>.app". A version is
// readable only if it matches ^[0-9][0-9A-Za-z.+-]*$ (Violet, 4 Nov); otherwise the fallback name
// is used, per app: "Midst (version unknown).app", "Midst Beta (version unknown).app"
// (cyril-9137f1ee, #402: Beta is never dropped from the name). A taken name gets " (2)" ... " (99)".
// The fallback wording is waiting on Stuart (4 Nov): change it here, and only here.
const UNKNOWN = '(version unknown)';
const unknownStem = (stem = 'Midst') => `${stem} ${UNKNOWN}`;
const fallback = (n, stem = 'Midst') =>
  n ? `${unknownStem(stem)} (${n}).app` : `${unknownStem(stem)}.app`;
const betaFallback = (n) => fallback(n, 'Midst Beta');
const ours = (version) => ({ ...OURS, CFBundleShortVersionString: version });

// How the warning names an app it will keep (Stuart, 4 Nov: the exact version that would be
// deleted): by the same version rule as the kept file's name, else "(version unknown)".
const READABLE = /^[0-9][0-9A-Za-z.+-]*$/;
function label(app, info) {
  const base = app === 'Midst Beta.app' ? 'Midst Beta' : 'Midst';
  const version = info && info.CFBundleShortVersionString;
  return typeof version === 'string' && READABLE.test(version)
    ? `${base} ${version}`
    : `${base} (version unknown)`;
}
// The apps the installer finds, in the order it handles them: Beta first.
const found = (before) =>
  ['Midst Beta.app', 'Midst.app'].filter((n) => n in before);

const CASES = [
  { name: 'nothing installed', before: {}, after: [] },
  {
    name: 'our own Midst, an earlier release, is kept as "Midst 0.2.1"',
    before: { 'Midst.app': OURS },
    after: ['Midst 0.2.1.app'],
  },
  {
    name: 'our own Midst at the version being installed (0.3.0) is kept',
    before: { 'Midst.app': ours('0.3.0') },
    after: ['Midst 0.3.0.app'],
  },
  {
    name: 'our own Midst at a later release (1.0.0) is kept',
    before: { 'Midst.app': ours('1.0.0') },
    after: ['Midst 1.0.0.app'],
  },
  {
    name: 'the original app (our id, 0.0.x) is kept',
    before: { 'Midst.app': ORIGINAL },
    after: ['Midst 0.0.5.app'],
  },
  {
    name: 'Midst Beta is kept as "Midst Beta <its version>", whatever its id',
    before: {
      'Midst Beta.app': {
        CFBundleIdentifier: 'com.example.unknown',
        CFBundleShortVersionString: '9.9',
      },
    },
    after: ['Midst Beta 9.9.app'],
  },
  {
    name: 'a Midst.app with another id is kept, named with its version',
    before: {
      'Midst.app': { ...OURS, CFBundleIdentifier: 'com.example.other' },
    },
    after: ['Midst 0.2.1.app'],
  },
  {
    name: 'every allowed character survives into the name',
    before: { 'Midst.app': ours('1.0.0-rc.1+build.5') },
    after: ['Midst 1.0.0-rc.1+build.5.app'],
  },
  {
    name: 'a Midst.app with no Info.plist is kept under the fallback name',
    before: { 'Midst.app': null },
    after: [fallback()],
  },
  {
    name: 'no version in the Info.plist: the fallback name',
    before: { 'Midst.app': { CFBundleIdentifier: 'press.Midst.MidstApp' } },
    after: [fallback()],
  },
  {
    name: 'an empty version: the fallback name',
    before: { 'Midst.app': ours('') },
    after: [fallback()],
  },
  // "beta" would name our app "Midst beta.app", which APFS (case-insensitive) takes for Midst Beta.
  ...['beta', 'Beta', 'BETA'].map((version) => ({
    name: `the version "${version}": the fallback name, never "Midst Beta.app"`,
    before: { 'Midst.app': ours(version) },
    after: [fallback()],
  })),
  ...['x1.0', '.1.0', '-1.0', '+1'].map((version) => ({
    name: `a version that does not start with a digit ("${version}"): the fallback name`,
    before: { 'Midst.app': ours(version) },
    after: [fallback()],
  })),
  ...['1.0 beta', '1.0/../x', '1.0_1', '1.0:2', '1.0é'].map((version) => ({
    name: `a version with a character outside [0-9A-Za-z.+-] ("${version}"): the fallback name`,
    before: { 'Midst.app': ours(version) },
    after: [fallback()],
  })),
  {
    name: 'Midst Beta with no version: its own fallback name, Beta kept in it',
    before: { 'Midst Beta.app': {} },
    after: [betaFallback()],
  },
  {
    name: 'Midst Beta and the original are both kept, each with its own name',
    before: { 'Midst Beta.app': {}, 'Midst.app': ORIGINAL },
    after: [betaFallback(), 'Midst 0.0.5.app'],
  },
  {
    name: 'Midst Beta and our Midst at the same version get distinct names',
    before: { 'Midst Beta.app': ours('0.2.1'), 'Midst.app': OURS },
    after: ['Midst 0.2.1.app', 'Midst Beta 0.2.1.app'],
  },
  {
    name: 'both unreadable: each takes its own fallback name',
    before: { 'Midst Beta.app': {}, 'Midst.app': null },
    after: [betaFallback(), fallback()],
  },
  {
    name: 'a kept "Midst 0.2.1" already there is never written over: " (2)"',
    before: { 'Midst 0.2.1.app': {}, 'Midst.app': OURS },
    after: ['Midst 0.2.1 (2).app', 'Midst 0.2.1.app'],
  },
  {
    name: 'with " (2)" taken as well: " (3)"',
    before: {
      'Midst 0.2.1.app': {},
      'Midst 0.2.1 (2).app': {},
      'Midst.app': OURS,
    },
    after: ['Midst 0.2.1 (2).app', 'Midst 0.2.1 (3).app', 'Midst 0.2.1.app'],
  },
  {
    name: 'the fallback name already there is never written over: " (2)"',
    before: { [fallback()]: {}, 'Midst.app': null },
    after: [fallback(), fallback(2)],
  },
  {
    name: 'Beta\'s fallback name already there is never written over: " (2)"',
    before: { [betaFallback()]: {}, 'Midst Beta.app': {} },
    after: [betaFallback(), betaFallback(2)],
  },
  {
    name: 'an app kept by an earlier release, under its old name, is left alone',
    before: { 'Midst (previous version).app': {}, 'Midst.app': OURS },
    after: ['Midst (previous version).app', 'Midst 0.2.1.app'],
  },
  {
    name: 'unrelated apps are left alone',
    before: { 'Other.app': ORIGINAL, 'Midst.app': OURS },
    after: ['Midst 0.2.1.app', 'Other.app'],
  },
];

describe('older Midst: installer warning and rename agree', () => {
  test.each(CASES)('$name: installer warning', ({ before, after }) => {
    const v = volume(before);
    const keeps = after.filter((n) => !(n in before)).length > 0;
    const { passed, result, visible, labels } = installerCheck(v.applications);
    expect(passed).toBe(!keeps);
    expect(visible).toBe(keeps);
    expect(result.type).toBe(keeps ? 'Warning' : undefined);
    const expected = found(before).map((n) => label(n, before[n]));
    expect(labels).toEqual(expected);
    const names = expected.join(' and ');
    const many = expected.length > 1;
    expect(result.title).toBe(
      keeps
        ? `${names} ${many ? 'are' : 'is'} already in your Applications folder`
        : undefined
    );
    // One sentence per app, in the same order: a version is promised only where there is one
    // (cyril-9137f1ee, #402).
    const sentences = expected
      .map((l) =>
        l.endsWith(UNKNOWN)
          ? `${l} will be kept under that name, because its version could not be read.`
          : `${l} will be kept, renamed to show its version.`
      )
      .join(' ');
    expect(result.message).toBe(
      keeps
        ? `The new Midst will be installed as “Midst”. ${sentences}\n\n` +
            `To delete ${names} instead, click Customize at the Installation Type step and tick ` +
            '“Delete the Midst that’s already installed”.'
        : undefined
    );
    expect(String(result.message)).not.toMatch(/previous version/i);
  });
});

describeOnMac(
  'older Midst: the preinstall renames what the warning names',
  () => {
    test.each(CASES)('$name: preinstall', ({ before, after }) => {
      const v = volume(before);
      const r = run(PREINSTALL, v);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(listing(v.applications)).toEqual([...after].sort());
      // The record names exactly the apps this run renamed.
      const added = after
        .filter((n) => !(n in before))
        .map((n) => path.join(v.applications, n));
      const recorded = fs
        .readFileSync(v.record, 'utf8')
        .split('\n')
        .filter(Boolean);
      expect([...recorded].sort()).toEqual([...added].sort());
      // The warning's label for each app names the version its kept copy carries: the copy is
      // "<label>.app" or "<label> (N).app", or under the fallback name exactly where the label
      // says "(version unknown)". The record is in the order the apps were handled, as the labels are.
      const { labels } = installerCheck(volume(before).applications);
      expect(recorded).toHaveLength(labels.length);
      labels.forEach((l, i) => {
        const escaped = l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(path.basename(recorded[i])).toMatch(
          new RegExp(`^${escaped}( \\(([2-9]|[1-9][0-9])\\))?\\.app$`)
        );
      });
      // A run that kept everything says so, beside the record (#397).
      expect(fs.existsSync(`${v.record}.done`)).toBe(true);
    });
  }
);

describeOnMac('preinstall failures stop the install with nothing moved', () => {
  test('a record it cannot write', () => {
    const v = volume({ 'Midst.app': ORIGINAL });
    const r = run(PREINSTALL, {
      ...v,
      record: path.join(v.root, 'missing-dir', 'record'),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FAILED');
    expect(listing(v.applications)).toEqual(['Midst.app']);
  });

  test('no INSTALLER_TEMP and no override', () => {
    const v = volume({ 'Midst.app': ORIGINAL });
    const r = spawnSync(
      '/bin/bash',
      [PREINSTALL, '/x/Midst.pkg', '/Applications', v.root],
      {
        encoding: 'utf8',
        env: { PATH: process.env.PATH },
      }
    );
    expect(r.status).toBe(1);
    expect(listing(v.applications)).toEqual(['Midst.app']);
  });
});

describeOnMac('preinstall: a record that is not a plain file', () => {
  test('a directory where the record goes stops the install with nothing moved', () => {
    const v = volume({ 'Midst.app': OURS });
    fs.mkdirSync(v.record);
    const r = run(PREINSTALL, v);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not a plain file');
    expect(listing(v.applications)).toEqual(['Midst.app']);
  });

  test('a directory where the completion marker goes stops the install with nothing moved', () => {
    const v = volume({ 'Midst.app': OURS });
    fs.mkdirSync(`${v.record}.done`);
    const r = run(PREINSTALL, v);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not a plain file');
    expect(listing(v.applications)).toEqual(['Midst.app']);
  });
});

// "<base>.app" and "<base> (2..n).app": the n names one kept app can take.
function namesFor(base, n) {
  return [`${base}.app`].concat(
    Array.from({ length: n - 1 }, (_, i) => `${base} (${i + 2}).app`)
  );
}

describeOnMac('preinstall: the 99 names for one kept app run out', () => {
  test('99 "Midst 0.2.1" names taken: nothing moves and the install stops', () => {
    const taken = Object.fromEntries(
      namesFor('Midst 0.2.1', 99).map((n) => [n, {}])
    );
    const v = volume({ ...taken, 'Midst.app': OURS });
    const r = run(PREINSTALL, v);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no free name for');
    expect(fs.existsSync(`${v.record}.done`)).toBe(false);
    expect(listing(v.applications)).toEqual(
      [...namesFor('Midst 0.2.1', 99), 'Midst.app'].sort()
    );
    expect(fs.readFileSync(v.record, 'utf8')).toBe('');
  });

  // Midst.app's 99 names taken, Beta's free: Midst Beta (no version) has moved when Midst.app
  // (no version) finds no name. The install still stops before the new app is written, so
  // Midst.app is never written over. Beta's own names: " (99)" is still its last.
  test("Midst.app's names all taken: Beta moves, then Midst.app stops the install", () => {
    const taken = Object.fromEntries(
      [
        ...namesFor(unknownStem(), 99),
        ...namesFor(unknownStem('Midst Beta'), 98),
      ].map((n) => [n, {}])
    );
    const v = volume({ ...taken, 'Midst Beta.app': {}, 'Midst.app': null });
    const r = run(PREINSTALL, v);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no free name for');
    expect(fs.existsSync(`${v.record}.done`)).toBe(false);
    const now = listing(v.applications);
    expect(now).toContain('Midst.app');
    expect(now).not.toContain('Midst Beta.app');
    expect(now).toContain(betaFallback(99));
    expect(now).toHaveLength(99 + 99 + 1);
    expect(fs.readFileSync(v.record, 'utf8')).toBe(
      `${path.join(v.applications, betaFallback(99))}\n`
    );
  });

  // A first run that stopped part-way, then another run in the same install (the same record):
  // it refuses, moves nothing more, and still leaves no marker (alden-ec2221c7, #397).
  test('after a run that stopped part-way, the next run refuses and moves nothing more', () => {
    const taken = Object.fromEntries(
      namesFor(unknownStem(), 99).map((n) => [n, {}])
    );
    const v = volume({ ...taken, 'Midst Beta.app': {}, 'Midst.app': null });
    expect(run(PREINSTALL, v).status).toBe(1);
    const afterFirst = listing(v.applications);
    const recordAfterFirst = fs.readFileSync(v.record, 'utf8');
    const r = run(PREINSTALL, v);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('did not finish');
    expect(listing(v.applications)).toEqual(afterFirst);
    expect(afterFirst).toContain('Midst.app');
    expect(fs.readFileSync(v.record, 'utf8')).toBe(recordAfterFirst);
    expect(fs.existsSync(`${v.record}.done`)).toBe(false);
  });
});

describeOnMac('opt-in delete', () => {
  // The preinstall runs first, then the new app is installed, then (only if ticked) the delete.
  // `lateRun`: one more preinstall run after the new app is written, which nothing documents
  // the installer never does (#397).
  function installed(before, preinstallRuns = 1, lateRun = false) {
    const v = volume(before);
    const preinstall = () => {
      const pre = run(PREINSTALL, v);
      if (pre.status !== 0) throw new Error(`preinstall failed: ${pre.stderr}`);
      return pre;
    };
    for (let n = 0; n < preinstallRuns; n += 1) preinstall();
    const contents = path.join(v.applications, 'Midst.app', 'Contents');
    fs.mkdirSync(contents, { recursive: true });
    fs.writeFileSync(
      path.join(contents, 'Info.plist'),
      plist({ ...OURS, CFBundleShortVersionString: '0.3.0' })
    );
    if (lateRun) {
      v.doneBeforeLate = fs.existsSync(`${v.record}.done`);
      v.late = preinstall();
    }
    return v;
  }

  const newVersion = (v) =>
    fs.readFileSync(
      path.join(v.applications, 'Midst.app', 'Contents', 'Info.plist'),
      'utf8'
    );

  test('deletes exactly the apps this install kept', () => {
    const v = installed({
      'Midst Beta.app': {},
      'Midst.app': ORIGINAL,
      [betaFallback()]: {},
      'Midst 0.0.5.app': {},
      'Other.app': {},
    });
    const r = run(REMOVE, v);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    // The kept apps that were already there are not this install's to delete.
    expect(listing(v.applications)).toEqual(
      [betaFallback(), 'Midst 0.0.5.app', 'Midst.app', 'Other.app'].sort()
    );
    expect(newVersion(v)).toContain('<string>0.3.0</string>');
  });

  // macOS Installer runs the app's preinstall twice in one install, in the same sandbox (#353,
  // install.log of the 0.9.0 candidate). Only the first run acts (#397).
  test('a preinstall run after the new app is written leaves it alone, and the delete takes only what the first run kept', () => {
    const v = installed({ 'Midst Beta.app': {}, 'Midst.app': OURS }, 1, true);
    expect(v.doneBeforeLate).toBe(true);
    expect(v.late.stdout).toContain('renaming nothing');
    expect(listing(v.applications)).toEqual(
      [betaFallback(), 'Midst 0.2.1.app', 'Midst.app'].sort()
    );
    expect(newVersion(v)).toContain('<string>0.3.0</string>');
    const recorded = fs
      .readFileSync(v.record, 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(recorded.sort()).toEqual(
      [
        path.join(v.applications, betaFallback()),
        path.join(v.applications, 'Midst 0.2.1.app'),
      ].sort()
    );
    const r = run(REMOVE, v);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(listing(v.applications)).toEqual(['Midst.app']);
    expect(newVersion(v)).toContain('<string>0.3.0</string>');
  });

  test('a preinstall run twice in one install still deletes what the first run kept', () => {
    const v = installed({ 'Midst Beta.app': {}, 'Midst.app': ORIGINAL }, 2);
    const r = run(REMOVE, v);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(listing(v.applications)).toEqual(['Midst.app']);
  });

  test('ticked, it deletes our own earlier release too', () => {
    const v = installed({ 'Midst.app': OURS });
    const r = run(REMOVE, v);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('deleted Midst 0.2.1.app');
    expect(listing(v.applications)).toEqual(['Midst.app']);
    expect(newVersion(v)).toContain('<string>0.3.0</string>');
  });

  // With every Midst kept, nothing is kept only when there was no Midst.
  test('nothing kept, nothing deleted', () => {
    const v = installed({ 'Other.app': {} });
    const r = run(REMOVE, v);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('nothing was deleted');
    expect(listing(v.applications)).toEqual(['Midst.app', 'Other.app']);
  });

  test('refuses when the new Midst is not in place', () => {
    const v = volume({ 'Midst.app': ORIGINAL });
    expect(run(PREINSTALL, v).status).toBe(0);
    const r = run(REMOVE, v);
    expect(r.status).toBe(1);
    expect(listing(v.applications)).toEqual(['Midst 0.0.5.app']);
  });

  test('refuses with no record', () => {
    const v = volume({ 'Midst.app': OURS, 'Midst 0.0.5.app': {} });
    const r = run(REMOVE, v);
    expect(r.status).toBe(1);
    expect(listing(v.applications)).toEqual(['Midst 0.0.5.app', 'Midst.app']);
  });

  // Every name the preinstall can give a kept app, and only those (Violet, 4 Nov).
  test.each([
    'Midst 0.9.3.app',
    'Midst 0.9.3 (2).app',
    'Midst 0.9.3 (99).app',
    'Midst 1.0.0-rc.1+build.5.app',
    'Midst Beta 0.0.3.app',
    'Midst Beta 9.9 (3).app',
    fallback(),
    fallback(2),
    fallback(99),
    betaFallback(),
    betaFallback(2),
    betaFallback(99),
  ])('deletes a recorded "%s"', (name) => {
    const v = volume({ 'Midst.app': ours('0.3.0'), [name]: {} });
    fs.writeFileSync(v.record, `${path.join(v.applications, name)}\n`);
    const r = run(REMOVE, v);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(listing(v.applications)).toEqual(['Midst.app']);
  });

  // A recorded name the preinstall would never give, in Applications, is refused and left alone.
  // "Midst.app" in any case is the new install itself (APFS is case-insensitive), and "Midst
  // Beta.app" in any case fits "Midst <v>.app" with v = "Beta": both are refused by name.
  test.each([
    ['Midst.app', null],
    ['midst.app', null],
    ['MIDST.APP', null],
    ['Midst Beta.app', 'Midst Beta.app'],
    ['midst beta.app', 'Midst Beta.app'],
    ['MIDST BETA.app', 'Midst Beta.app'],
    ['Midst beta.app', 'Midst Beta.app'],
    ['Midst x1.0.app', 'Midst x1.0.app'],
    ['Midst 0.9 3.app', 'Midst 0.9 3.app'],
    ['Midst 0.9.3_1.app', 'Midst 0.9.3_1.app'],
    ['Midst 0.9.3 (1).app', 'Midst 0.9.3 (1).app'],
    ['Midst 0.9.3 (100).app', 'Midst 0.9.3 (100).app'],
    ['Midst 0.9.3 (02).app', 'Midst 0.9.3 (02).app'],
    ['Midst 0.9.3(2).app', 'Midst 0.9.3(2).app'],
    ['Midst Alpha (version unknown).app', 'Midst Alpha (version unknown).app'],
    ['Midst (version unknown) (1).app', 'Midst (version unknown) (1).app'],
    [
      'Midst Beta (version unknown) (100).app',
      'Midst Beta (version unknown) (100).app',
    ],
    ['Midst (previous version).app', 'Midst (previous version).app'],
    ['Midst (previous version 2).app', 'Midst (previous version 2).app'],
    ['Midst 0.9.3', 'Midst 0.9.3'],
    ['Other.app', 'Other.app'],
  ])('refuses a recorded "%s"', (name, onDisk) => {
    const v = volume({ 'Midst.app': ours('0.3.0') });
    if (onDisk) fs.mkdirSync(path.join(v.applications, onDisk));
    fs.writeFileSync(v.record, `${path.join(v.applications, name)}\n`);
    const r = run(REMOVE, v);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refusing');
    expect(listing(v.applications)).toEqual(
      ['Midst.app', ...(onDisk ? [onDisk] : [])].sort()
    );
    expect(newVersion(v)).toContain('<string>0.3.0</string>');
  });

  test.each([
    ['outside Applications', (v) => path.join(v.root, 'Midst 0.9.3.app')],
    ['climbing out', (v) => path.join(v.applications, '..', 'Midst 0.9.3.app')],
  ])('refuses a recorded path %s', (_label, target) => {
    const v = volume({ 'Midst.app': OURS, 'Other.app': {} });
    fs.mkdirSync(path.join(v.root, 'Midst 0.9.3.app'));
    fs.writeFileSync(v.record, `${target(v)}\n`);
    const r = run(REMOVE, v);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refusing');
    expect(listing(v.applications)).toEqual(['Midst.app', 'Other.app']);
    expect(fs.existsSync(path.join(v.root, 'Midst 0.9.3.app'))).toBe(true);
  });
});

// The shape electron-builder 26 generates (productbuild --synthesize plus its <domains>).
const GENERATED = `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
    <pkg-ref id="press.Midst.MidstApp"/>
    <product id="press.Midst.MidstApp" version="0.3.0"/>
    <title>Midst</title>
    <options customize="never" require-scripts="false" hostArchitectures="arm64"/>
    <choices-outline>
        <line choice="default">
            <line choice="press.Midst.MidstApp"/>
        </line>
    </choices-outline>
    <choice id="default" title="Midst" versStr="0.3.0"/>
    <choice id="press.Midst.MidstApp" title="Midst" visible="false">
        <pkg-ref id="press.Midst.MidstApp"/>
    </choice>
    <pkg-ref id="press.Midst.MidstApp" version="0.3.0" onConclusion="none">press.Midst.MidstApp.pkg</pkg-ref>
    <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true" />
</installer-gui-script>
`;

describe('Distribution edit', () => {
  const checkJs = fs.readFileSync(CHECK_JS, 'utf8');
  const doc = (xml) => new DOMParser().parseFromString(xml, 'application/xml');

  test('adds the warning and an unticked delete choice after the app, and stays well-formed', () => {
    const out = doc(editDistribution(GENERATED, checkJs, '0.3.0'));
    expect(out.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(out.querySelector('options').getAttribute('customize')).toBe(
      'allow'
    );
    expect(
      out.querySelector('choice[id="default"]').getAttribute('enabled')
    ).toBe('false');
    expect(out.querySelector('installation-check').getAttribute('script')).toBe(
      'midstPreviousCheck()'
    );
    expect(out.querySelector('script').textContent).toContain(
      'function midstPreviousCheck'
    );

    const outline = [...out.querySelectorAll('choices-outline > line')].map(
      (l) => l.getAttribute('choice')
    );
    expect(outline).toEqual(['default', REMOVE_ID]);

    const remove = out.querySelector(`choice[id="${REMOVE_ID}"]`);
    expect(remove.getAttribute('start_selected')).toBe('false');
    expect(remove.getAttribute('title')).toBe(
      'Delete the Midst that’s already installed'
    );
    expect(remove.getAttribute('visible')).toBe('midstHasPrevious()');
    expect(remove.getAttribute('description')).toMatch(/PERMANENTLY deletes/);
    expect(remove.getAttribute('description')).toMatch(/cannot be undone/);
    expect(remove.getAttribute('description')).toMatch(
      /renamed to show its version/
    );
    // Stuart (4 Nov): not the words "previous version" where the poet reads (the warning: above).
    expect(remove.getAttribute('description')).not.toMatch(/previous version/i);
    expect(
      out.querySelector(`pkg-ref[id="${REMOVE_ID}"][version="0.3.0"]`)
        .textContent
    ).toBe(`${REMOVE_ID}.pkg`);
  });

  test('refuses a Distribution it does not recognise, or one already edited', () => {
    expect(() =>
      editDistribution(
        GENERATED.replace('customize="never"', 'customize="allow"'),
        checkJs,
        '0.3.0'
      )
    ).toThrow(/customize="never"/);
    expect(() =>
      editDistribution(
        GENERATED.replace('</choices-outline>', ''),
        checkJs,
        '0.3.0'
      )
    ).toThrow(/exactly one/);
    const once = editDistribution(GENERATED, checkJs, '0.3.0');
    expect(() => editDistribution(once, checkJs, '0.3.0')).toThrow(/already/);
  });
});
