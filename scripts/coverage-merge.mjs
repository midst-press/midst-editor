/* eslint-disable no-console, no-restricted-syntax, no-continue -- a Node CLI that prints its report, over plain loops */
// Unit + e2e line coverage for midst-editor, per file and in total (midst-editor#29).
//
//   node scripts/coverage-merge.mjs          (npm run coverage runs the layers first, then this)
//
// Layers, all istanbul JSON from V8 (layout agreed on #29):
//   unit       coverage/unit/coverage-final.json, from jest --coverageProvider=v8 (every src file listed)
//   e2e        coverage/e2e/v8/*.json, raw V8 from e2e/coverage.ts and NODE_V8_COVERAGE, converted here by c8
// Merged and summarised by nyc. Prints numbers and src/ paths only.
//
// No converter layer (#206). The converter left src/main/util.ts for midst-format (editor #202) and comes in as
// built code under vendor/, outside src/; its coverage is midst-format's own report.
//
// LINES ONLY. V8 gives one statement per line, and the unit and e2e layers then have identical statement maps
// per file (checked: every file both load), so nyc merges lines exactly. Branch and function maps come from
// different bundles and do not line up, so merged branch and function totals would count one branch twice.
//
// ONE TRAP, MEASURED: Electron writes a "source-map-cache" into the main process's V8 files, and c8 trusts it.
// With it, every main-process file read 100% after one playback spec (menu.ts 641/641); without it, c8 reads
// main.js.map from disk and menu.ts reads 352/641. The cache is stripped before conversion.
//
// CONTROLS, every run; exit 1 if one fails, 2 on missing input:
//   1 pipeline  a fixture with called() and neverCalled(), run under NODE_V8_COVERAGE and taken through the same
//               c8 + nyc path: neverCalled's body must be 0 hits and called's covered.
//   2 reach     the e2e layer must include main-process code (main.ts) and window code (Replay/index.tsx) with
//               some line covered, or that half of the collector is dead.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COV = path.join(ROOT, 'coverage');
const C8 = require.resolve('c8/bin/c8.js');
const NYC = require.resolve('nyc/bin/nyc.js');

// Every path as src/..., so the same file from two layers (or two checkouts) is one file.
const rel = (p) => {
  const s = p.replace(/\\/g, '/');
  const i = s.lastIndexOf('/src/');
  return i < 0 ? null : s.slice(i + 1);
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(process.execPath, [cmd, ...args], {
    cwd: ROOT,
    stdio: 'ignore',
    ...opts,
  });
  if (r.status !== 0)
    throw new Error(`${path.basename(cmd)} ${args[0]} exited ${r.status}`);
}

// Raw V8 dir -> istanbul JSON with c8, after stripping the source-map-cache and other processes' scripts.
function convertV8(rawDir, outDir, srcDir) {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-v8-'));
  try {
    for (const f of fs.readdirSync(rawDir).filter((n) => n.endsWith('.json'))) {
      const d = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8'));
      delete d['source-map-cache'];
      d.result = d.result.filter((r) => r.url.startsWith('file://'));
      fs.writeFileSync(path.join(staged, f), JSON.stringify(d));
    }
    run(
      C8,
      [
        'report',
        '--temp-directory',
        staged,
        '--reports-dir',
        outDir,
        '--reporter=json',
        '--all',
        '--src',
        srcDir,
        '--extension',
        '.ts',
        '--extension',
        '.tsx',
        '--extension',
        '.js',
        '--include',
        'src/**',
        '--exclude',
        '**/__tests__/**',
        '--exclude',
        '**/*.d.ts',
        '--exclude-after-remap',
      ],
      { cwd: path.dirname(srcDir) }
    );
    return JSON.parse(
      fs.readFileSync(path.join(outDir, 'coverage-final.json'), 'utf8')
    );
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

// Keep statements only (see LINES ONLY) and key by src/... path.
function linesOnly(json) {
  const out = {};
  for (const [file, fc] of Object.entries(json)) {
    const r = rel(file);
    if (!r || r.includes('__tests__')) continue;
    out[r] = {
      path: r,
      statementMap: fc.statementMap,
      s: fc.s,
      fnMap: {},
      f: {},
      branchMap: {},
      b: {},
    };
  }
  return out;
}

// nyc report over a set of layers -> {file: {covered, total}} for lines.
function summarise(layers, root = ROOT) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-nyc-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-nyc-out-'));
  try {
    layers.forEach((l, i) =>
      fs.writeFileSync(path.join(dir, `${i}.json`), JSON.stringify(l))
    );
    run(
      NYC,
      [
        'report',
        '--temp-dir',
        dir,
        '--report-dir',
        out,
        '--reporter=json-summary',
        '--exclude-after-remap=false',
      ],
      { cwd: root }
    );
    const s = JSON.parse(
      fs.readFileSync(path.join(out, 'coverage-summary.json'), 'utf8')
    );
    delete s.total;
    return Object.fromEntries(
      Object.entries(s).map(([k, v]) => [
        rel(k) || k,
        { covered: v.lines.covered, total: v.lines.total },
      ])
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
}

function pipelineControl() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-cov-ctl-'));
  try {
    const src = path.join(tmp, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(
      path.join(src, 'control.js'),
      [
        'function called(x) {',
        '  return x + 1;',
        '}',
        'function neverCalled(x) {',
        '  const y = x * 2;',
        '  return y - 1;',
        '}',
        'called(1);',
        '',
      ].join('\n')
    );
    const raw = path.join(tmp, 'v8');
    spawnSync(process.execPath, [path.join(src, 'control.js')], {
      env: { ...process.env, NODE_V8_COVERAGE: raw },
    });
    const fc = linesOnly(convertV8(raw, path.join(tmp, 'out'), src))[
      'src/control.js'
    ];
    const hits = (line) =>
      Object.entries(fc.statementMap)
        .filter(([, l]) => l.start.line === line)
        .map(([i]) => fc.s[i])[0];
    const sum = summarise([{ 'src/control.js': fc }], tmp)['src/control.js'];
    return (
      hits(2) > 0 &&
      hits(8) > 0 &&
      hits(5) === 0 &&
      hits(6) === 0 &&
      sum &&
      sum.covered < sum.total
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const unitFile = path.join(COV, 'unit', 'coverage-final.json');
const rawDir = path.join(COV, 'e2e', 'v8');
if (!fs.existsSync(unitFile)) {
  console.error(
    'missing coverage/unit/coverage-final.json: run jest --coverage --coverageProvider=v8 first'
  );
  process.exit(2);
}
if (
  !fs.existsSync(rawDir) ||
  !fs.readdirSync(rawDir).some((f) => f.endsWith('.json'))
) {
  console.error(
    'missing coverage/e2e/v8/*.json: run the e2e suite with COVERAGE=1 against a COVERAGE=1 build'
  );
  process.exit(2);
}

const unit = linesOnly(JSON.parse(fs.readFileSync(unitFile, 'utf8')));
const e2e = linesOnly(
  convertV8(rawDir, path.join(COV, 'e2e', 'istanbul'), path.join(ROOT, 'src'))
);
const U = summarise([unit]);
const E = summarise([e2e]);
const C = summarise([unit, e2e]);
const pct = (x) =>
  x && x.total ? ((100 * x.covered) / x.total).toFixed(1) : '-';
const files = Object.keys(C).sort();
console.log(
  `${'file (lines %)'.padEnd(54)} ${'unit'.padStart(6)} ${'e2e'.padStart(
    6
  )} ${'combined'.padStart(9)}`
);
for (const f of files)
  console.log(
    `${f.padEnd(54)} ${pct(U[f]).padStart(6)} ${pct(E[f]).padStart(6)} ${pct(
      C[f]
    ).padStart(9)}`
  );
// Every column over the combined file list: a file absent from a layer counts as 0 of its lines there.
const tot = (S) =>
  files.reduce(
    (a, f) => ({
      covered: a.covered + (S[f]?.covered ?? 0),
      total: a.total + C[f].total,
    }),
    { covered: 0, total: 0 }
  );
const [tu, te, tc] = [tot(U), tot(E), tot(C)];
console.log(
  `${'TOTAL'.padEnd(54)} ${pct(tu).padStart(6)} ${pct(te).padStart(6)} ${pct(
    tc
  ).padStart(9)}   (${tc.covered}/${tc.total} lines, ${files.length} files)`
);
console.log(
  "not collected: src/main/preload.ts (e2e runs it in the preload's isolated world, which neither collector reaches)"
);

const c1 = pipelineControl();
const c2 =
  (E['src/main/main.ts']?.covered ?? 0) > 0 &&
  (E['src/renderer/components/Replay/index.tsx']?.covered ?? 0) > 0;
console.log(
  `control 1 (fixture: neverCalled 0 hits, called covered, through c8 + nyc): ${
    c1 ? 'holds' : 'FAILED'
  }`
);
console.log(
  `control 2 (e2e reaches the main process and the window): ${
    c2 ? 'holds' : 'FAILED'
  }`
);
// Control 4 (vivian-1a61bc9a): with Electron's source-map-cache trusted, every main-process file read 100%. The
// main-process files must keep at least one line e2e never ran; if the over-read comes back, this fires.
const c4 = ['src/main/main.ts', 'src/main/menu.ts'].some((f) =>
  Object.values(e2e[f]?.s ?? {}).some((n) => n === 0)
);
console.log(
  `control 4 (main-process files are not all read as run: the source-map-cache over-read is absent): ${
    c4 ? 'holds' : 'FAILED'
  }`
);
process.exit(c1 && c2 && c4 ? 0 : 1);
