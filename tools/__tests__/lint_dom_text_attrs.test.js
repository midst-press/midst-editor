/**
 * @jest-environment node
 */
// The renderer's lint rules for words in title, aria-valuetext and aria-description on a DOM element (#234,
// #251), run through the real eslint and .eslintrc.js on a file written into the renderer. The file has to be on
// disk inside src/renderer: the type-aware parser refuses a file outside the lint project, and the rules apply
// only there. The directory is in .gitignore and .eslintignore, hence --no-ignore. Invented words only.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'src', 'renderer', '__lint_scratch__');
const FILE = path.join(DIR, `dom-text-attrs-${process.pid}.tsx`);

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
  fs.mkdirSync(DIR, { recursive: true });
  const body = Object.entries(CASES).map(
    ([tag, jsx]) => `  // case:${tag}\n  out.push(${jsx});`
  );
  fs.writeFileSync(
    FILE,
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
    'npx',
    ['eslint', '--no-ignore', '-f', 'json', path.relative(ROOT, FILE)],
    { cwd: ROOT, encoding: 'utf8' }
  );
  const lines = fs.readFileSync(FILE, 'utf8').split('\n');
  results = { status: r.status, stderr: r.stderr, byTag: {} };
  const [{ messages }] = JSON.parse(r.stdout);
  lines.forEach((l, i) => {
    const m = l.match(/\/\/ case:(\w+)$/);
    // The case is the line after its tag; eslint lines are 1-based.
    if (m) results.byTag[m[1]] = messages.filter((msg) => msg.line === i + 2);
  });
}, 120_000);

afterAll(() => {
  fs.rmSync(FILE, { force: true });
  if (fs.existsSync(DIR) && fs.readdirSync(DIR).length === 0) fs.rmdirSync(DIR);
});

const rules = (tag) => results.byTag[tag].map((m) => m.ruleId);
const words = (tag) =>
  results.byTag[tag].filter(
    (m) => m.ruleId === 'no-restricted-syntax' && m.message.startsWith(WORDS)
  );

it('eslint ran and reported errors (exit 1, not a crash)', () => {
  expect(results.status).toBe(1);
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
