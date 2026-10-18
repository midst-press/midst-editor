#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax, global-require, import/no-dynamic-require, no-underscore-dangle -- a Node CLI that prints its report, over plain loops */
// Read-only census of zero-width-only paragraphs (midst-format #7, GitHub #31). For a directory of
// .midst or .midst.zip files, converts each with the repo's convertMidstFile (vendor/midst-format/convert) and counts
// paragraphs holding only zero-width characters (U+FEFF, U+200B-U+200D, U+2060, literal or as a character
// reference), in the converted text and, for comparison, in the file's raw final old-format frame.
//
//   node tools/zero_width_census.cjs <dir> [--log <file>]
//
// Prints ONLY counts: no file name, path, title or text, here or in the log. A file that fails is counted
// by error class name (stderr and the log; the log path is printed). Nothing is written but the log.
// Exit: 0 done; 1 some file failed; 2 usage. Needs `npm ci`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ZW = '\\uFEFF\\u200B\\u200C\\u200D\\u2060';
const ZW_ENTITY = [0xfeff, 0x200b, 0x200c, 0x200d, 0x2060]
  .map((c) => `&#(?:x0*${c.toString(16)}|0*${c});`)
  .join('|');
const PARAGRAPH = /<p\b[^>]*>(.*?)<\/p>/gis;
const ZW_ONLY = new RegExp(`^(?:[${ZW}]|${ZW_ENTITY})+$`, 'i');

// Paragraphs whose whole text is zero-width characters (and at least one of them).
function countZeroWidthParagraphs(html) {
  let n = 0;
  for (const m of html.matchAll(PARAGRAPH)) {
    if (ZW_ONLY.test(m[1].replace(/<[^>]*>/g, ''))) n += 1;
  }
  return n;
}

function loadConverter(repo) {
  // The converter is the vendored midst-format build: plain CommonJS, no electron and no store.
  return require(path.join(
    repo,
    'vendor',
    'midst-format',
    'convert',
    'index.cjs'
  )).convertMidstFile;
}

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (/\.midst(\.zip)?$/.test(e.name) && !e.name.startsWith('._'))
      out.push(p);
  }
  return out.sort();
}

function readMidst(file) {
  if (!file.endsWith('.zip')) return fs.readFileSync(file, 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zwc-'));
  try {
    execFileSync('unzip', ['-q', '-j', '-o', file, '-d', tmp], {
      stdio: 'pipe',
    });
    const inner = fs
      .readdirSync(tmp)
      .filter((n) => n.endsWith('.midst') && !n.startsWith('._'));
    if (inner.length !== 1) throw new Error('ENTRY_COUNT');
    return fs.readFileSync(path.join(tmp, inner[0]), 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main(argv) {
  const args = argv.slice(2);
  const li = args.indexOf('--log');
  const logFile =
    li >= 0
      ? args.splice(li, 2)[1]
      : path.join(os.tmpdir(), `zero_width_census_${process.pid}.log`);
  if (args.length !== 1 || !fs.existsSync(args[0]) || !logFile) {
    console.error(
      'usage: node tools/zero_width_census.cjs <dir> [--log <file>]'
    );
    return 2;
  }
  const files = listFiles(args[0]);
  if (!files.length) {
    console.error('no .midst or .midst.zip files in the directory');
    return 1;
  }
  const convertMidstFile = loadConverter(path.resolve(__dirname, '..'));
  const errors = new Map();
  const c = { read: 0, convWith: 0, convParas: 0, rawWith: 0, rawParas: 0 };
  fs.writeFileSync(logFile, '');
  for (const [i, file] of files.entries()) {
    try {
      const old = readMidst(file);
      const frames = JSON.parse(old).editorTimelineFrames;
      const raw = countZeroWidthParagraphs(frames[frames.length - 1].content);
      const conv = countZeroWidthParagraphs(
        JSON.parse(convertMidstFile(old)).text
      );
      c.read += 1;
      c.rawParas += raw;
      c.convParas += conv;
      if (raw) c.rawWith += 1;
      if (conv) c.convWith += 1;
    } catch (e) {
      const cls = (e && e.constructor && e.constructor.name) || 'Unknown';
      errors.set(cls, (errors.get(cls) || 0) + 1);
      const line = `file ${i + 1}: ${cls}`;
      console.error(line);
      fs.appendFileSync(logFile, `${line}\n`);
    }
  }
  const failed = [...errors.values()].reduce((a, b) => a + b, 0);
  console.log(`files found                         ${files.length}`);
  console.log(`files read and converted            ${c.read}`);
  console.log(
    `converted: files with a zero-width-only paragraph  ${c.convWith}`
  );
  console.log(`converted: such paragraphs, total   ${c.convParas}`);
  console.log(`raw final frame: files with one     ${c.rawWith}`);
  console.log(`raw final frame: such paragraphs    ${c.rawParas}`);
  console.log(`files that failed                   ${failed}`);
  for (const [cls, n] of errors) console.log(`  ${cls}: ${n}`);
  console.log(`log: ${logFile}`);
  return failed ? 1 : 0;
}

process.exit(main(process.argv));
