/**
 * @jest-environment jsdom
 */
// Issue 16: the macOS installer keeps an older Midst as "Midst (previous version)" and deletes it
// only when the poet opts in. Three pieces decide or act on "older Midst", and each is run here
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
const KEPT = ['Midst (previous version).app'];
const CASES = [
  { name: 'nothing installed', before: {}, after: [] },
  {
    name: 'our own Midst, an earlier release, is kept',
    before: { 'Midst.app': OURS },
    after: KEPT,
  },
  {
    name: 'our own Midst at the version being installed (0.3.0) is kept',
    before: { 'Midst.app': { ...OURS, CFBundleShortVersionString: '0.3.0' } },
    after: KEPT,
  },
  {
    name: 'our own Midst at a later release (1.0.0) is kept',
    before: { 'Midst.app': { ...OURS, CFBundleShortVersionString: '1.0.0' } },
    after: KEPT,
  },
  {
    name: 'the original app (our id, 0.0.x) is kept',
    before: { 'Midst.app': ORIGINAL },
    after: KEPT,
  },
  {
    name: 'Midst Beta is kept, whatever is inside it',
    before: {
      'Midst Beta.app': {
        CFBundleIdentifier: 'com.example.unknown',
        CFBundleShortVersionString: '9.9',
      },
    },
    after: KEPT,
  },
  {
    name: 'a Midst.app with another id is kept',
    before: {
      'Midst.app': { ...OURS, CFBundleIdentifier: 'com.example.other' },
    },
    after: KEPT,
  },
  {
    name: 'a Midst.app with no Info.plist is kept, not written over',
    before: { 'Midst.app': null },
    after: KEPT,
  },
  {
    name: 'a version that is not a version is kept',
    before: { 'Midst.app': { ...OURS, CFBundleShortVersionString: 'beta' } },
    after: KEPT,
  },
  {
    name: 'Midst Beta and the original are both kept, with distinct names',
    before: { 'Midst Beta.app': {}, 'Midst.app': ORIGINAL },
    after: ['Midst (previous version 2).app', 'Midst (previous version).app'],
  },
  {
    name: 'Midst Beta beside our own Midst: both are kept, with distinct names',
    before: { 'Midst Beta.app': {}, 'Midst.app': OURS },
    after: ['Midst (previous version 2).app', 'Midst (previous version).app'],
  },
  {
    name: 'an existing "previous version" is never written over',
    before: { 'Midst (previous version).app': {}, 'Midst.app': OURS },
    after: ['Midst (previous version 2).app', 'Midst (previous version).app'],
  },
  {
    name: 'unrelated apps are left alone',
    before: { 'Other.app': ORIGINAL, 'Midst.app': OURS },
    after: ['Midst (previous version).app', 'Other.app'],
  },
];

describe('older Midst: installer warning and rename agree', () => {
  test.each(CASES)('$name: installer warning', ({ before, after }) => {
    const v = volume(before);
    const keeps = after.filter((n) => !(n in before)).length > 0;
    const { passed, result, visible } = installerCheck(v.applications);
    expect(passed).toBe(!keeps);
    expect(visible).toBe(keeps);
    expect(result.type).toBe(keeps ? 'Warning' : undefined);
    expect(String(result.message)).toMatch(
      keeps ? /Midst \(previous version\)/ : /^undefined$/
    );
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
      expect(listing(v.applications)).toEqual(after);
      // The record names exactly the apps this run renamed.
      const added = after
        .filter((n) => !(n in before))
        .map((n) => path.join(v.applications, n));
      const recorded = fs
        .readFileSync(v.record, 'utf8')
        .split('\n')
        .filter(Boolean);
      expect(recorded.sort()).toEqual(added.sort());
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
});

// "Midst (previous version).app" and "Midst (previous version 2..N).app".
function previousNames(n) {
  return ['Midst (previous version).app'].concat(
    Array.from(
      { length: n - 1 },
      (_, i) => `Midst (previous version ${i + 2}).app`
    )
  );
}

describeOnMac('preinstall: the 99 kept names run out', () => {
  // 98 taken, one free: Midst Beta takes the last name and has moved when Midst.app finds none.
  // The install still stops before the new app is written, so Midst.app is never written over.
  test('98 taken: Beta takes the 99th name, then Midst.app stops the install', () => {
    const taken = Object.fromEntries(previousNames(98).map((n) => [n, {}]));
    const v = volume({ ...taken, 'Midst Beta.app': {}, 'Midst.app': OURS });
    const r = run(PREINSTALL, v);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no free name for');
    const now = listing(v.applications);
    expect(now).toContain('Midst.app');
    expect(now).not.toContain('Midst Beta.app');
    expect(now).toContain('Midst (previous version 99).app');
    expect(now).toHaveLength(100);
    expect(fs.readFileSync(v.record, 'utf8')).toBe(
      `${path.join(v.applications, 'Midst (previous version 99).app')}\n`
    );
  });

  test('99 taken: nothing moves and the install stops', () => {
    const taken = Object.fromEntries(previousNames(99).map((n) => [n, {}]));
    const v = volume({ ...taken, 'Midst Beta.app': {}, 'Midst.app': OURS });
    const r = run(PREINSTALL, v);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no free name for');
    expect(listing(v.applications)).toEqual(
      [...previousNames(99), 'Midst Beta.app', 'Midst.app'].sort()
    );
    expect(fs.readFileSync(v.record, 'utf8')).toBe('');
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
    if (lateRun) v.late = preinstall();
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
      'Midst (previous version).app': {},
      'Other.app': {},
    });
    const r = run(REMOVE, v);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    // The "previous version" that was already there is not this install's to delete.
    expect(listing(v.applications)).toEqual([
      'Midst (previous version).app',
      'Midst.app',
      'Other.app',
    ]);
  });

  // macOS Installer runs the app's preinstall twice in one install, in the same sandbox (#353,
  // install.log of the 0.9.0 candidate). The second run finds nothing left to rename; it must not
  // wipe the record the first run wrote, or the ticked delete deletes nothing and reports success.
  test('a preinstall run after the new app is written leaves it alone, and the delete takes only what the first run kept', () => {
    const v = installed({ 'Midst Beta.app': {}, 'Midst.app': OURS }, 1, true);
    expect(v.late.stdout).toContain('renaming nothing');
    expect(listing(v.applications)).toEqual([
      'Midst (previous version 2).app',
      'Midst (previous version).app',
      'Midst.app',
    ]);
    expect(newVersion(v)).toContain('<string>0.3.0</string>');
    const recorded = fs
      .readFileSync(v.record, 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(recorded.sort()).toEqual(
      [
        path.join(v.applications, 'Midst (previous version 2).app'),
        path.join(v.applications, 'Midst (previous version).app'),
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
    expect(r.stdout).toContain('deleted Midst (previous version).app');
    expect(listing(v.applications)).toEqual(['Midst.app']);
    const info = fs.readFileSync(
      path.join(v.applications, 'Midst.app', 'Contents', 'Info.plist'),
      'utf8'
    );
    expect(info).toContain('<string>0.3.0</string>');
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
    expect(listing(v.applications)).toEqual(['Midst (previous version).app']);
  });

  test('refuses with no record', () => {
    const v = volume({ 'Midst.app': OURS, 'Midst (previous version).app': {} });
    const r = run(REMOVE, v);
    expect(r.status).toBe(1);
    expect(listing(v.applications)).toEqual([
      'Midst (previous version).app',
      'Midst.app',
    ]);
  });

  test.each([
    [
      'outside Applications',
      (v) => path.join(v.root, 'Midst (previous version).app'),
    ],
    ['with another name', (v) => path.join(v.applications, 'Other.app')],
    [
      'climbing out',
      (v) => path.join(v.applications, '..', 'Midst (previous version).app'),
    ],
  ])('refuses a recorded path %s', (_label, target) => {
    const v = volume({ 'Midst.app': OURS, 'Other.app': {} });
    fs.mkdirSync(path.join(v.root, 'Midst (previous version).app'));
    fs.writeFileSync(v.record, `${target(v)}\n`);
    const r = run(REMOVE, v);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refusing');
    expect(listing(v.applications)).toEqual(['Midst.app', 'Other.app']);
    expect(
      fs.existsSync(path.join(v.root, 'Midst (previous version).app'))
    ).toBe(true);
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
    expect(remove.getAttribute('visible')).toBe('midstHasPrevious()');
    expect(remove.getAttribute('description')).toMatch(/PERMANENTLY deletes/);
    expect(remove.getAttribute('description')).toMatch(/cannot be undone/);
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
