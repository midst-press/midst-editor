/**
 * @jest-environment node
 */
// tools/check-main-strings.mjs, run on main-process sources written into a temp dir.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'check-main-strings.mjs');

let root;
const write = (rel, text) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const check = (...args) => {
  const r = spawnSync('node', [SCRIPT, '--root', root, ...args], {
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout + r.stderr };
};
const lines = (out) => out.split('\n').filter((l) => l.startsWith('src/'));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-main-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('passes catalog calls, references and empty strings', () => {
  write(
    'src/main/menu.ts',
    [
      "const template = [{ label: i18n._('menu.file.save'), accelerator: 'CmdOrCtrl+S' },",
      '  { label: computed, role: "quit" }, { label: "" }];',
      "dialog.showMessageBox({ title: i18n._('dialog.x.title'), buttons: [i18n._('a'), i18n._('b')] });",
      "const log = { level: 'info', id: 'zq-not-a-word-property' };",
    ].join('\n')
  );
  const { status, out } = check();
  expect(status).toBe(0);
  expect(out).toContain('Main-process words outside the catalog: 0');
});

it.each([
  ['a string', "{ label: 'zq Save' }"],
  // eslint-disable-next-line no-template-curly-in-string -- source text for the checker, not a template
  ['a template', '{ title: `zq Open ${name}` }'],
  ['a template with no substitution', '{ message: `zq Saved` }'],
  ['an array holding one', "{ buttons: [i18n._('ok'), 'zq Cancel'] }"],
  ['a conditional with one branch', "{ detail: x ? i18n._('a') : 'zq b' }"],
  ['a concatenation', "{ sublabel: 'zq ' + count }"],
  ['a fallback', "{ toolTip: hint || 'zq hint' }"],
  ['a cast', "{ checkboxLabel: ('zq remember' as string) }"],
])(
  'fails on words written out as %s, naming the line and property',
  (_, object) => {
    write('src/main/menu.ts', `// line 1\nconst x = ${object};\n`);
    const { status, out } = check();
    expect(status).toBe(1);
    expect(lines(out)).toEqual([
      expect.stringMatching(
        /^src\/main\/menu\.ts:2: \w+ is written out; it belongs in the catalog\.$/
      ),
    ]);
    expect(out).not.toContain('zq');
  }
);

it('reads `name` as words only inside a dialog filter', () => {
  write(
    'src/main/main.ts',
    [
      "dialog.showSaveDialog({ filters: [{ name: 'zq Midst poems', extensions: ['midst'] }] });",
      "app.setAppUserModelId({ name: 'zq-app-id' });",
    ].join('\n')
  );
  expect(lines(check().out)).toEqual([
    'src/main/main.ts:1: name is written out; it belongs in the catalog.',
  ]);
});

it('scans src/main recursively, skipping tests and declaration files', () => {
  write('src/main/a/b.ts', "x({ label: 'zq' });\n");
  write('src/main/__tests__/helpers.ts', "x({ label: 'zq' });\n");
  write('src/main/c.test.ts', "x({ label: 'zq' });\n");
  write('src/main/types.d.ts', "export const y = { label: 'zq' };\n");
  write('src/renderer/d.ts', "x({ label: 'zq' });\n");
  expect(lines(check().out)).toEqual([
    'src/main/a/b.ts:1: label is written out; it belongs in the catalog.',
  ]);
});

it('checks only the files named, when files are given', () => {
  write('src/main/a.ts', "x({ label: 'zq' });\n");
  write('src/main/b.ts', "x({ label: 'zq' });\n");
  expect(lines(check('src/main/b.ts').out)).toEqual([
    'src/main/b.ts:1: label is written out; it belongs in the catalog.',
  ]);
});

it('--report-only prints the findings and exits 0', () => {
  write('src/main/menu.ts', "x({ label: 'zq' });\n");
  const { status, out } = check('--report-only');
  expect(status).toBe(0);
  expect(out).toContain(
    'Main-process words outside the catalog: 1 (report only, not failing)'
  );
});

it('exits 2 on an unknown flag or an unreadable file', () => {
  expect(check('--nope').status).toBe(2);
  expect(check('src/main/missing.ts').status).toBe(2);
});
