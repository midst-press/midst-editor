/**
 * @jest-environment node
 */
// tools/check-catalog.mjs. Every case runs the CLI on a catalog written into a temp dir: a clean English
// and French pair passes, and each failure is one injected fault on top of it.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'check-catalog.mjs');

const HEADER =
  'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=utf-8\\n"\n"Language: {lang}\\n"\n';
const entry = ({ id, text, fuzzy = false, en, obsolete = false }) => {
  if (obsolete)
    return `#~ msgid ${JSON.stringify(id)}\n#~ msgstr ${JSON.stringify(
      text
    )}\n`;
  const lines = [];
  if (en !== undefined) lines.push(`# en: ${JSON.stringify(en)}`);
  lines.push('#. js-lingui-explicit-id', '#: src/main/menu.ts');
  if (fuzzy) lines.push('#, fuzzy');
  lines.push(`msgid ${JSON.stringify(id)}`, `msgstr ${JSON.stringify(text)}`);
  return `${lines.join('\n')}\n`;
};
const po = (lang, entries) =>
  [HEADER.replace('{lang}', lang), ...entries.map(entry)].join('\n');

const SAVE = 'zq Save';
const OPEN = 'zq Open {fileName}';
const COUNT =
  'zq {count, plural, one {# change to {fileName}} other {# changes}}';
const EN = [
  { id: 'menu.file.save', text: SAVE },
  { id: 'menu.file.open', text: OPEN },
  { id: 'notice.changes', text: COUNT },
];
const FR = [
  { id: 'menu.file.save', text: 'zq Enregistrer', en: SAVE },
  { id: 'menu.file.open', text: 'zq Ouvrir {fileName}', en: OPEN },
];

let root;
const write = (rel, text) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const writeCatalog = ({ en = EN, fr = FR, locales = ['en', 'fr'] } = {}) => {
  write(
    'lingui.config.js',
    `module.exports = { locales: ${JSON.stringify(
      locales
    )}, sourceLocale: 'en' };\n`
  );
  if (en) write('locales/en/messages.po', po('en', en));
  if (fr) write('locales/fr/messages.po', po('fr', fr));
};
// CATALOG_BASE is never inherited: a value set for CI's catalog step must not reach these runs (#287).
const runCheck = (env, args) => {
  const { CATALOG_BASE: _, ...rest } = process.env;
  const r = spawnSync('node', [SCRIPT, '--root', root, ...args], {
    encoding: 'utf8',
    env: { ...rest, ...env },
  });
  return { status: r.status, out: r.stdout + r.stderr };
};
const check = (...args) => runCheck({}, args);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-catalog-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('a clean catalog', () => {
  it('passes, and reports the French it does not have yet', () => {
    writeCatalog();
    const { status, out } = check();
    expect(status).toBe(0);
    expect(out).toContain('Catalog: no problems.');
    expect(out).toMatch(
      /Not yet translated into fr \(shown in English\): 1\n {2}notice\.changes/
    );
    expect(out).toContain('Drafts awaiting review: 0');
  });

  it('prints ids and never the words', () => {
    writeCatalog({
      fr: [{ id: 'menu.file.save', text: 'zq Enregistrer {x}', en: SAVE }],
    });
    const { out } = check();
    expect(out).toContain('menu.file.save');
    expect(out).not.toContain('zq');
  });
});

describe('English', () => {
  it.each([
    [
      'the id as its text, which is what extract writes for new code',
      'menu.file.save',
    ],
    ['an empty text', ''],
  ])('fails on an entry with no English: %s', (_, text) => {
    writeCatalog({
      en: [{ id: 'menu.file.save', text }],
      fr: null,
      locales: ['en'],
    });
    const { status, out } = check();
    expect(status).toBe(1);
    expect(out).toContain(
      'locales/en/messages.po: menu.file.save has no English.'
    );
  });

  it('fails on an obsolete entry, a key no code uses', () => {
    writeCatalog({
      en: [...EN, { id: 'menu.old', text: 'zq Old', obsolete: true }],
    });
    const { status, out } = check();
    expect(status).toBe(1);
    expect(out).toContain('menu.old is no longer used by any code (obsolete).');
  });

  it('fails on a message that is not ICU', () => {
    writeCatalog({ en: [...EN, { id: 'menu.bad', text: 'zq {unclosed' }] });
    const { status, out } = check();
    expect(status).toBe(1);
    expect(out).toMatch(
      /locales\/en\/messages\.po: menu\.bad is not valid ICU MessageFormat/
    );
  });

  it('reports a fuzzy entry as a draft, without failing', () => {
    writeCatalog({ en: [{ ...EN[0], fuzzy: true }, ...EN.slice(1)] });
    const { status, out } = check();
    expect(status).toBe(0);
    expect(out).toMatch(
      /Drafts awaiting review: 1\n {2}locales\/en\/messages\.po: menu\.file\.save/
    );
  });
});

describe('a translation', () => {
  it('fails on a key English does not have', () => {
    writeCatalog({
      fr: [...FR, { id: 'menu.extra', text: 'zq Extra', en: 'zq Extra' }],
    });
    const { status, out } = check();
    expect(status).toBe(1);
    expect(out).toContain(
      'locales/fr/messages.po: menu.extra is not an English key.'
    );
  });

  it('fails when a placeholder is dropped or renamed', () => {
    writeCatalog({
      fr: [FR[0], { id: 'menu.file.open', text: 'zq Ouvrir {name}', en: OPEN }],
    });
    const { status, out } = check();
    expect(status).toBe(1);
    expect(out).toContain(
      'menu.file.open has placeholders name; the English has fileName.'
    );
  });

  it('counts the placeholders inside plural cases', () => {
    writeCatalog({
      fr: [
        ...FR,
        {
          id: 'notice.changes',
          text: 'zq {count, plural, other {# changements}}',
          en: COUNT,
        },
      ],
    });
    const { status, out } = check();
    expect(status).toBe(1);
    expect(out).toContain(
      'notice.changes has placeholders count; the English has count, fileName.'
    );
  });

  it('passes the same placeholders in another order and another plural shape', () => {
    const text =
      'zq {count, plural, one {{fileName} : # changement} other {# changements}}';
    writeCatalog({ fr: [...FR, { id: 'notice.changes', text, en: COUNT }] });
    expect(check().status).toBe(0);
  });

  it.each([
    ['English that has changed since', 'zq Save the poem'],
    ['no recorded English', undefined],
  ])(
    'fails when it was translated from %s, unless it is marked draft',
    (_, en) => {
      writeCatalog({ fr: [{ ...FR[0], en }, FR[1]] });
      const failed = check();
      expect(failed.status).toBe(1);
      expect(failed.out).toContain(
        'menu.file.save was translated from English that has changed, or records none'
      );

      writeCatalog({ fr: [{ ...FR[0], en, fuzzy: true }, FR[1]] });
      const drafted = check();
      expect(drafted.status).toBe(0);
      expect(drafted.out).toContain('locales/fr/messages.po: menu.file.save');
    }
  );
});

describe('--fix', () => {
  it('marks an out-of-date translation draft and records the current English, touching nothing else', () => {
    writeCatalog({ fr: [{ ...FR[0], en: 'zq Save the poem' }, FR[1]] });
    const before = fs.readFileSync(
      path.join(root, 'locales/fr/messages.po'),
      'utf8'
    );

    const fixed = check('--fix');
    expect(fixed.status).toBe(0);
    expect(fixed.out).toContain('marked 1 out-of-date translation(s) draft');

    const after = fs.readFileSync(
      path.join(root, 'locales/fr/messages.po'),
      'utf8'
    );
    const want = po('fr', [{ ...FR[0], en: SAVE, fuzzy: true }, FR[1]]);
    expect(after).toBe(want);
    expect(after).not.toBe(before);

    const again = check();
    expect(again.status).toBe(0);
    expect(again.out).toContain('Drafts awaiting review: 1');
  });

  it('adds fuzzy to an existing flags line rather than a second one', () => {
    const file = path.join(root, 'locales/fr/messages.po');
    writeCatalog({ fr: [{ ...FR[0], en: 'zq Old' }, FR[1]] });
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, 'utf8')
        .replace(
          'msgid "menu.file.save"',
          '#, c-format\nmsgid "menu.file.save"'
        )
    );
    check('--fix');
    const after = fs.readFileSync(file, 'utf8');
    expect(after).toContain('#, c-format, fuzzy\nmsgid "menu.file.save"');
    expect(after.match(/^#, /gm)).toHaveLength(1);
  });

  it('marks an entry whose msgid wraps onto a continuation line', () => {
    writeCatalog({ fr: [{ ...FR[0], en: 'zq Save old' }, FR[1]] });
    const file = path.join(root, 'locales/fr/messages.po');
    const wrapped = fs
      .readFileSync(file, 'utf8')
      .replace('msgid "menu.file.save"', 'msgid ""\n"menu.file.save"');
    fs.writeFileSync(file, wrapped);

    const fixed = check('--fix');
    expect(fixed.status).toBe(0);
    expect(fixed.out).toContain('marked 1 out-of-date translation(s) draft');
    const after = fs.readFileSync(file, 'utf8');
    expect(after).toContain(
      `# en: ${JSON.stringify(
        SAVE
      )}\n#. js-lingui-explicit-id\n#: src/main/menu.ts\n#, fuzzy\nmsgid ""\n"menu.file.save"`
    );
    expect(check().status).toBe(0);
  });

  it('fails, naming the id, when it cannot find an entry to fix, rather than reporting it fixed', () => {
    writeCatalog({ fr: [{ ...FR[0], en: 'zq Save old' }, FR[1]] });
    const file = path.join(root, 'locales/fr/messages.po');
    // CRLF line endings: PO readers accept them, and --fix's line edit does not find the entry.
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n')
    );
    const fixed = check('--fix');
    expect(fixed.status).toBe(1);
    expect(fixed.out).toContain('marked 0 out-of-date translation(s) draft');
    expect(fixed.out).toContain(
      'locales/fr/messages.po: menu.file.save is out of date, and --fix could not find its entry to mark it draft.'
    );
  });

  it('leaves a current catalog byte-identical', () => {
    writeCatalog();
    const file = path.join(root, 'locales/fr/messages.po');
    const before = fs.readFileSync(file, 'utf8');
    check('--fix');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('locales and documents', () => {
  it('fails on a locale folder the config does not list', () => {
    writeCatalog({ locales: ['en'] });
    const { status, out } = check();
    expect(status).toBe(1);
    expect(out).toContain(
      'locales/fr/ is not a locale lingui.config.js lists.'
    );
  });

  it('fails on a listed locale with no catalog', () => {
    writeCatalog({ fr: null });
    const { status, out } = check();
    expect(status).toBe(1);
    expect(out).toContain('locales/fr/messages.po is missing.');
  });

  it('fails on a translated document with no English one, and reports draft documents', () => {
    writeCatalog();
    write(
      'locales/en/docs/user-guide.md',
      '---\nstatus: draft\n---\n\nzq words\n'
    );
    write('locales/fr/docs/about.md', 'zq mots\n');
    const { status, out } = check();
    expect(status).toBe(1);
    expect(out).toContain(
      'locales/fr/docs/about.md has no English document of the same name.'
    );
    expect(out).toMatch(
      /Drafts awaiting review: 1\n {2}locales\/en\/docs\/user-guide\.md/
    );
  });

  it('does not take status: draft outside the front matter as a draft', () => {
    writeCatalog();
    write('locales/en/docs/user-guide.md', 'zq words\n\nstatus: draft\n');
    expect(check().out).toContain('Drafts awaiting review: 0');
  });
});

describe('modes and usage', () => {
  it('--report-only prints the problems and exits 0', () => {
    writeCatalog({
      en: [{ id: 'menu.file.save', text: '' }],
      fr: null,
      locales: ['en'],
    });
    const { status, out } = check('--report-only');
    expect(status).toBe(0);
    expect(out).toContain('Catalog problems: 1 (report only, not failing)');
  });

  it('exits 2 on an unknown argument or a root with no config', () => {
    writeCatalog();
    expect(check('--nope').status).toBe(2);
    fs.rmSync(path.join(root, 'lingui.config.js'));
    expect(check().status).toBe(2);
  });
});

// #287: an English entry new since the base and not marked draft would skip the review list. The base here is the
// temp root's own git history: the catalog is committed, then changed.
describe('new English entries against the base', () => {
  const git = (...args) => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  const commitBase = () => {
    writeCatalog();
    git('init', '-q');
    git('add', '-A');
    git(
      '-c',
      'user.name=zq',
      '-c',
      'user.email=zq@example.invalid',
      'commit',
      '-q',
      '-m',
      'base'
    );
  };
  const withEnglish = (extra) => writeCatalog({ en: [...EN, ...extra] });
  const atBase = (...args) => runCheck({ CATALOG_BASE: 'HEAD' }, args);

  it('fails on a new entry with no draft mark, naming it', () => {
    commitBase();
    withEnglish([{ id: 'menu.file.export', text: 'zq Export' }]);
    const r = atBase();
    expect(r.status).toBe(1);
    expect(r.out).toContain('New-entry check: against HEAD');
    expect(r.out).toContain(
      'locales/en/messages.po: menu.file.export is new and not marked draft (#, fuzzy)'
    );
    expect(r.out).not.toContain('zq Export');
  });

  it('passes a new entry marked draft, and lists it for review', () => {
    commitBase();
    withEnglish([{ id: 'menu.file.export', text: 'zq Export', fuzzy: true }]);
    const r = atBase();
    expect(r.status).toBe(0);
    expect(r.out).toContain('locales/en/messages.po: menu.file.export');
  });

  it('passes entries the base already had, marked or not', () => {
    commitBase();
    const r = atBase();
    expect(r.status).toBe(0);
    expect(r.out).toContain('Catalog: no problems.');
  });

  it('says it did not run when there is no base, and checks the rest', () => {
    writeCatalog({
      en: [...EN, { id: 'menu.file.export', text: 'zq Export' }],
    });
    const r = check();
    expect(r.status).toBe(0);
    expect(r.out).toContain('New-entry check NOT RUN: no base');
  });

  it('exits 2 when the base cannot be read, rather than reporting nothing new', () => {
    commitBase();
    const r = runCheck({ CATALOG_BASE: 'no-such-ref' }, []);
    expect(r.status).toBe(2);
    expect(r.out).toContain(
      'cannot read locales/en/messages.po at no-such-ref'
    );
  });
});
