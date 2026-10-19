#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax -- a Node CLI that prints its report, over plain loops */
// Read-only census of lines before and after conversion (GitHub #169). The tag count that found "3 poems gain a
// paragraph" used a regex, which miscounted elsewhere; this parses instead. The raw final frame is parsed as the
// old editor's browser parsed it (jsdom: a <p> inside a <p> closes the first, a <div> closes a <p>), and its lines
// are its top-level blocks plus each top-level run of inline content. The conversion's lines are its top-level
// blocks. Each line is classed by its text: empty, whitespace (spaces, tabs, newlines, no-break spaces),
// zero-width (only U+FEFF, U+200B-U+200D, U+2060, perhaps with whitespace), or text. In a browser an empty or
// whitespace-only paragraph has no height, while the new editor shows every paragraph as a line, so the classes
// say which differences a reader would see.
//
//   node tools/paragraph_census.cjs <dir> [--log <file>]
//
// Prints ONLY counts and poem numbers (P<n>, the file's position in sorted order, from 1): no file name, path,
// title or text, here or in the log. One line per poem whose classes differ. A file that fails is counted by
// error class name (stderr and the log; the log path is printed). Nothing is written but the log.
// Exit: 0 done; 1 a file failed; 2 usage. A difference is a finding, not a failure. Needs `npm ci`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseHtml,
  listFiles,
  readMidst,
  loadConverter,
} = require('./tab_census.cjs');

const CLASSES = ['empty', 'whitespace', 'zeroWidth', 'text'];
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
// The elements that make a line of their own; anything else at the top level is inline content.
const BLOCK = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'PRE',
]);

// Explicit sets: JS `\s` also matches U+FEFF, which would class a zero-width line as whitespace.
function classOf(text) {
  if (text === '') return 'empty';
  if (/^[ \t\n\r\f\u00a0]*$/.test(text)) return 'whitespace';
  if (/^[ \t\n\r\f\u00a0\ufeff\u200b-\u200d\u2060]*$/.test(text))
    return 'zeroWidth';
  return 'text';
}

// { empty, whitespace, zeroWidth, text, nestedP, total } for one HTML string. nestedP counts <p> elements that a
// lenient parser would keep inside another <p> (an open <p> seen before the first one closed), so a reader can tell
// whether the raw frame relied on the browser to close them.
function linesOf(html) {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  let inline = null;
  const flush = () => {
    if (inline !== null && !/^[ \t\n\r\f]*$/.test(inline))
      counts[classOf(inline)] += 1;
    inline = null;
  };
  for (const node of parseHtml(html).childNodes) {
    if (node.nodeType === ELEMENT_NODE && BLOCK.has(node.tagName)) {
      flush();
      counts[classOf(node.textContent)] += 1;
    } else if (node.nodeType === ELEMENT_NODE || node.nodeType === TEXT_NODE) {
      inline = (inline || '') + node.textContent;
    }
  }
  flush();
  let depth = 0;
  let nestedP = 0;
  for (const m of html.matchAll(/<(\/?)p\b[^>]*>/gi)) {
    if (m[1]) depth = Math.max(0, depth - 1);
    else {
      if (depth > 0) nestedP += 1;
      depth += 1;
    }
  }
  const total = CLASSES.reduce((a, c) => a + counts[c], 0);
  return { ...counts, nestedP, total };
}

// One poem's line counts, raw final frame and conversion.
function censusOf(old, convertMidstFile) {
  const frames = JSON.parse(old).editorTimelineFrames;
  return {
    raw: linesOf(frames[frames.length - 1].content),
    converted: linesOf(JSON.parse(convertMidstFile(old)).text),
  };
}

const differs = (c) => CLASSES.some((k) => c.raw[k] !== c.converted[k]);
const row = (x) =>
  `total ${x.total} (empty ${x.empty}, whitespace ${x.whitespace}, zero-width ${x.zeroWidth}, text ${x.text})`;

// convert defaults to the vendored converter; the tests pass their own.
function main(argv, convert = null) {
  const args = argv.slice(2);
  const li = args.indexOf('--log');
  const logFile =
    li >= 0
      ? args.splice(li, 2)[1]
      : path.join(os.tmpdir(), `paragraph_census_${process.pid}.log`);
  if (args.length !== 1 || !fs.existsSync(args[0]) || !logFile) {
    console.error(
      'usage: node tools/paragraph_census.cjs <dir> [--log <file>]'
    );
    return 2;
  }
  const files = listFiles(args[0]);
  if (!files.length) {
    console.error('no .midst or .midst.zip files in the directory');
    return 1;
  }
  const convertMidstFile =
    convert || loadConverter(path.resolve(__dirname, '..'));
  const errors = new Map();
  const t = { read: 0, differing: 0, gained: 0, lost: 0, nestedP: 0 };
  fs.writeFileSync(logFile, '');
  for (const [i, file] of files.entries()) {
    try {
      const c = censusOf(readMidst(file), convertMidstFile);
      t.read += 1;
      if (c.raw.nestedP) t.nestedP += 1;
      if (differs(c)) {
        t.differing += 1;
        if (c.converted.total > c.raw.total) t.gained += 1;
        if (c.converted.total < c.raw.total) t.lost += 1;
        console.log(
          `P${i + 1}  raw ${row(c.raw)}, nested <p> ${c.raw.nestedP}`
        );
        console.log(`P${i + 1}  converted ${row(c.converted)}`);
      }
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
  console.log(`files read and converted            ${t.read}`);
  console.log(`poems whose line classes differ     ${t.differing}`);
  console.log(`  with more lines converted         ${t.gained}`);
  console.log(`  with fewer lines converted        ${t.lost}`);
  console.log(`poems whose raw frame nests a <p>   ${t.nestedP}`);
  console.log(`files that failed                   ${failed}`);
  for (const [cls, n] of errors) console.log(`  ${cls}: ${n}`);
  console.log(`log: ${logFile}`);
  return failed ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { linesOf, censusOf, main };
