/**
 * @jest-environment node
 */
// The renderer's lint rules for words in title, aria-valuetext and aria-description on a DOM element (#234,
// #251), run through the real eslint and .eslintrc.js. The type-aware parser needs the file on disk and in a
// tsconfig, and the rules apply only under src/renderer, so the file is written into src/renderer of a temporary
// tree with its own tsconfig. Not this repo's src: other tests read every file there. Invented words only.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let tree;

const WORDS = 'Words a reader sees or hears belong in the message catalog';

// Each case is one line, found by its tag, so a result is tied to the case and not to a line number.
const CASES = {
  plain: '<div title="Zqx words" />',
  braced: "<div title={'Zqx words'} />",
  // eslint-disable-next-line no-template-curly-in-string -- source text for eslint, not a template
  template: '<div title={`Zqx ${n}`} />',
  ternary: "<div aria-valuetext={on ? 'Zqx' : 'Qzx'} />",
  fallback: "<div aria-description={s ?? 'Zqx'} />",
  inMap: '<>{[1].map(() => <span title="Zqx" />)}</>',
  empty: '<div title="" />',
  // eslint-disable-next-line no-template-curly-in-string -- source text for eslint, not a template
  noLetters: '<div title={`${n}`} />',
  digits: '<div title="12 / 3" />',
  catalog: "<div title={i18n._('zqx.key')} />",
  catalogFallback: "<div title={s ?? i18n._('zqx.key')} />",
  component: '<Thing title="Zqx words" />',
  ariaLabel: '<div aria-label="Zqx words" />',
};

let results;

beforeAll(() => {
  // The real path: on macOS the temp dir is a symlink, and the parser compares real paths with tsconfigRootDir.
  tree = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'lint-dom-text-'))
  );
  const file = path.join(tree, 'src', 'renderer', 'cases.tsx');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    path.join(tree, 'tsconfig.eslint.json'),
    JSON.stringify({
      extends: path.join(ROOT, 'tsconfig.json'),
      compilerOptions: { skipLibCheck: true },
      include: ['src/**/*'],
    })
  );
  const body = Object.entries(CASES).map(
    ([tag, jsx]) => `  // case:${tag}\n  out.push(${jsx});`
  );
  fs.writeFileSync(
    file,
    [
      "import i18n from '../i18n';",
      '',
      'const Thing = (props: { title: string }) => <b>{props.title}</b>;',
      '',
      'export default function cases(on: boolean, n: number, s?: string) {',
      '  const out: unknown[] = [];',
      ...body,
      '  // case:forIn',
      '  for (const k in { a: 1 }) out.push(k);',
      '  return out;',
      '}',
      '',
    ].join('\n')
  );
  const r = spawnSync(
    path.join(ROOT, 'node_modules', '.bin', 'eslint'),
    [
      '--no-eslintrc',
      '--config',
      path.join(ROOT, '.eslintrc.js'),
      '--resolve-plugins-relative-to',
      ROOT,
      '--parser-options',
      `tsconfigRootDir:${tree}`,
      '-f',
      'json',
      'src/renderer/cases.tsx',
    ],
    {
      cwd: tree,
      encoding: 'utf8',
      // ts-node loads the webpack config for the import resolver, and would otherwise take the temporary tree's
      // tsconfig from the working directory.
      env: {
        ...process.env,
        TS_NODE_PROJECT: path.join(ROOT, 'tsconfig.json'),
      },
    }
  );
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  results = { status: r.status, stderr: r.stderr, byTag: {} };
  const [{ messages }] = JSON.parse(r.stdout);
  results.fatal = messages.filter((msg) => msg.ruleId === null);
  lines.forEach((l, i) => {
    const m = l.match(/\/\/ case:(\w+)$/);
    // The case is the line after its tag; eslint lines are 1-based.
    if (m) results.byTag[m[1]] = messages.filter((msg) => msg.line === i + 2);
  });
}, 120_000);

afterAll(() => fs.rmSync(tree, { recursive: true, force: true }));

// Formatting is left out: the temporary tree has no prettier config, and it is not what is tested here.
const rules = (tag) =>
  results.byTag[tag]
    .map((m) => m.ruleId)
    .filter((id) => id !== 'prettier/prettier');
const words = (tag) =>
  results.byTag[tag].filter(
    (m) => m.ruleId === 'no-restricted-syntax' && m.message.startsWith(WORDS)
  );

it('eslint ran and reported errors (exit 1, not a crash)', () => {
  expect(results.status).toBe(1);
  // A parse error also exits 1, with no rule id.
  expect(results.fatal).toEqual([]);
  expect(Object.keys(results.byTag)).toHaveLength(
    Object.keys(CASES).length + 1
  );
});

it.each(['plain', 'braced', 'template', 'inMap'])(
  'flags words in a DOM title: %s',
  (tag) => {
    expect(words(tag)).toHaveLength(1);
  }
);

it('flags both branches of a conditional, and a fallback', () => {
  expect(words('ternary')).toHaveLength(2);
  expect(words('fallback')).toHaveLength(1);
});

it.each(['empty', 'noLetters', 'digits', 'catalog', 'catalogFallback'])(
  'passes a value with no words in it: %s',
  (tag) => {
    expect(rules(tag)).toEqual([]);
  }
);

it('leaves a component to the lingui rule, which reports it', () => {
  expect(words('component')).toEqual([]);
  expect(rules('component')).toContain('lingui/no-unlocalized-strings');
});

it('still runs the lingui rule on a DOM element (aria-label)', () => {
  expect(rules('ariaLabel')).toEqual(['lingui/no-unlocalized-strings']);
});

it("keeps airbnb's for..in entry, which the override has to repeat", () => {
  expect(
    results.byTag.forIn.filter(
      (m) =>
        m.ruleId === 'no-restricted-syntax' && m.message.startsWith('for..in')
    )
  ).toHaveLength(1);
});
