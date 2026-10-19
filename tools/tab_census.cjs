#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax, global-require, import/no-dynamic-require -- a Node CLI that prints its report, over plain loops */
// Read-only census of tabs, to confirm they survive conversion (GitHub #17; Stuart, 16 Oct: tabs show as tabs).
// For a directory of .midst or .midst.zip files, counts the tabs in the text of each file's raw final old-format
// frame and in its conversion (vendor/midst-format/convert). A tab is a literal U+0009 or any character reference
// for it (&#9;, &#x9;, &Tab;), counted after the HTML is parsed as a browser parses it (jsdom), in text inside a <p>. The raw tabs are split by
// whether the nearest inline `white-space` around them is pre, pre-wrap, pre-line or break-spaces, which is
// how #17 counted 601 styled and 77 unstyled.
//
//   node tools/tab_census.cjs <dir> [--log <file>]
//
// Prints ONLY counts and poem numbers (P<n>, the file's position in sorted order, from 1): no file name, path,
// title or text, here or in the log. One line per poem with any tab. A file that fails is counted by error class
// name (stderr and the log; the log path is printed). Nothing is written but the log.
// Exit: 0 every tab survived; 1 a poem has fewer tabs after conversion, or a file failed; 2 usage. Needs `npm ci`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');

const PRESERVING = /^(pre|pre-wrap|pre-line|break-spaces)$/;
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

// HTML parsed as a browser parses it into an element, as the old editor's contenteditable did.
const { document } = new JSDOM('<!doctype html><body></body>').window;
function parseHtml(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

// The `white-space` value an element's inline style sets, or null when it sets none.
function inlineWhiteSpace(element) {
  const style = element.getAttribute('style') || '';
  const m = /(?:^|;)\s*white-space\s*:\s*([a-z-]+)/i.exec(style);
  return m ? m[1].toLowerCase() : null;
}

// Tabs in the text inside <p> elements, split by the nearest inline white-space: { styled, plain }.
function countTabs(html) {
  const counts = { styled: 0, plain: 0 };
  const walk = (node, inP, ws) => {
    if (node.nodeType === TEXT_NODE) {
      if (!inP) return;
      const n = (node.data.match(/\t/g) || []).length;
      if (PRESERVING.test(ws || '')) counts.styled += n;
      else counts.plain += n;
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const isP = node.tagName === 'P';
    const own = inlineWhiteSpace(node);
    for (const child of node.childNodes) walk(child, inP || isP, own || ws);
  };
  for (const child of parseHtml(html).childNodes) walk(child, false, null);
  return counts;
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tabc-'));
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

// One poem's counts: raw styled and plain tabs in its final frame, and tabs in its conversion.
function censusOf(old, convertMidstFile) {
  const frames = JSON.parse(old).editorTimelineFrames;
  const raw = countTabs(frames[frames.length - 1].content);
  const conv = countTabs(JSON.parse(convertMidstFile(old)).text);
  return {
    styled: raw.styled,
    plain: raw.plain,
    converted: conv.styled + conv.plain,
  };
}

// convert defaults to the vendored converter; the tests pass one that drops tabs.
function main(argv, convert = null) {
  const args = argv.slice(2);
  const li = args.indexOf('--log');
  const logFile =
    li >= 0
      ? args.splice(li, 2)[1]
      : path.join(os.tmpdir(), `tab_census_${process.pid}.log`);
  if (args.length !== 1 || !fs.existsSync(args[0]) || !logFile) {
    console.error('usage: node tools/tab_census.cjs <dir> [--log <file>]');
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
  const t = {
    read: 0,
    styled: 0,
    plain: 0,
    converted: 0,
    withTabs: 0,
    lost: 0,
  };
  fs.writeFileSync(logFile, '');
  for (const [i, file] of files.entries()) {
    try {
      const c = censusOf(readMidst(file), convertMidstFile);
      const raw = c.styled + c.plain;
      t.read += 1;
      t.styled += c.styled;
      t.plain += c.plain;
      t.converted += c.converted;
      if (raw || c.converted) {
        t.withTabs += 1;
        console.log(
          `P${i + 1}  raw ${raw} (styled ${c.styled}, plain ${
            c.plain
          })  converted ${c.converted}${c.converted < raw ? '  LOST' : ''}`
        );
      }
      if (c.converted < raw) t.lost += 1;
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
  console.log(`poems with a tab                    ${t.withTabs}`);
  console.log(`raw final frame: tabs, styled       ${t.styled}`);
  console.log(`raw final frame: tabs, plain        ${t.plain}`);
  console.log(`converted: tabs                     ${t.converted}`);
  console.log(`poems with fewer tabs converted     ${t.lost}`);
  console.log(`files that failed                   ${failed}`);
  for (const [cls, n] of errors) console.log(`  ${cls}: ${n}`);
  console.log(`log: ${logFile}`);
  return failed || t.lost ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  countTabs,
  censusOf,
  main,
  parseHtml,
  listFiles,
  readMidst,
  loadConverter,
};
