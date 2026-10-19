#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax -- a Node CLI that prints its report, over plain loops */
// Read-only census of lines before and after conversion (GitHub #169). The tag count that found "3 poems gain a
// paragraph" used a regex, which miscounted elsewhere; this parses instead. The raw final frame is parsed as the
// old editor's browser parsed it (jsdom: a <p> inside a <p> closes the first, a <div> closes a <p>), and its lines
// are its top-level blocks plus each top-level run of inline content. The conversion's lines are its top-level
// blocks. Each line is classed by what a browser draws for it:
//   empty       no text and no <br>: no height in a browser
//   whitespace  only spaces, tabs or newlines, none under a preserving white-space: collapses, no height
//   blank       a visible blank line: a <br>, a no-break space, spaces under an inline white-space of pre,
//               pre-wrap or break-spaces, or a newline under pre-line (cyril-9137f1ee, review of #227)
//   zeroWidth   only zero-width characters (U+FEFF, U+200B-U+200D, U+2060), perhaps with whitespace
//   text        anything else
// The new editor draws every paragraph, so in the conversion an empty or whitespace-only paragraph is classed
// `blank`: a raw `empty` line that converts to a `blank` one is a line the poet never saw (silas-397300f6, review of
// #227). `shown` is the lines a reader sees (all but empty and whitespace), and gained/lost compare it. `brs`
// counts the <br>s inside text lines that something follows (line breaks within one paragraph) on each side.
// `nestedP` is lexical: a count of <p> tags opened inside an open <p> in the raw source, which the parser repairs
// and so cannot see.
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

const CLASSES = ['empty', 'whitespace', 'blank', 'zeroWidth', 'text'];
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

// The inline white-space an element sets, or null.
const whiteSpaceOf = (el) => {
  const m = /(?:^|;)\s*white-space\s*:\s*([a-z-]+)/i.exec(
    el.getAttribute('style') || ''
  );
  return m ? m[1].toLowerCase() : null;
};
// Whether this element's text draws a blank line by its white-space: pre, pre-wrap and break-spaces keep spaces
// and tabs; pre-line collapses them and keeps only newlines (cyril-9137f1ee, review of #227).
const keepsBlank = (el) => {
  const ws = whiteSpaceOf(el);
  if (ws === 'pre-line') return /\n/.test(el.textContent);
  return (
    ['pre', 'pre-wrap', 'break-spaces'].includes(ws) && el.textContent !== ''
  );
};
const elementsIn = (node) =>
  node.nodeType === ELEMENT_NODE ? [node, ...node.querySelectorAll('*')] : [];

// The class of one line made of `nodes`. Explicit character sets: JS `\s` also matches U+FEFF, which would class
// a zero-width line as whitespace.
function classOf(nodes, editor) {
  const text = nodes.map((n) => n.textContent).join('');
  const elements = nodes.flatMap(elementsIn);
  if (/[^ \t\n\r\f\u00a0\ufeff\u200b-\u200d\u2060]/.test(text)) return 'text';
  if (/[\ufeff\u200b-\u200d\u2060]/.test(text)) return 'zeroWidth';
  if (
    elements.some((el) => el.tagName === 'BR') ||
    text.includes('\u00a0') ||
    (text !== '' && elements.some(keepsBlank))
  )
    return 'blank';
  if (editor) return 'blank'; // the new editor draws every paragraph
  return text === '' ? 'empty' : 'whitespace';
}

// A <br> draws a line break only when something follows it in its line: text that does not collapse, or another
// <br>. A trailing <br>, which contenteditable leaves behind, draws nothing (cyril-9137f1ee, review of #227).
const brsIn = (nodes) => {
  const last = nodes[nodes.length - 1];
  return nodes
    .flatMap(elementsIn)
    .filter((el) => el.tagName === 'BR')
    .filter((br) => {
      const range = br.ownerDocument.createRange();
      range.setStartAfter(br);
      range.setEndAfter(
        last.nodeType === ELEMENT_NODE ? last.lastChild || last : last
      );
      const after = range.cloneContents();
      return (
        /[^ \t\n\r\f]/.test(after.textContent) ||
        after.querySelector('br') !== null
      );
    }).length;
};

// { empty, whitespace, blank, zeroWidth, text, brs, nestedP, total } for one HTML string. nestedP counts <p>
// elements that a lenient parser would keep inside another <p> (an open <p> seen before the first one closed), so a
// reader can tell whether the raw frame relied on the browser to close them.
// `editor`: the HTML is the new editor's, which draws an empty paragraph as a blank line.
function linesOf(html, editor = false) {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  let brs = 0;
  const line = (nodes) => {
    const cls = classOf(nodes, editor);
    counts[cls] += 1;
    if (cls === 'text') brs += brsIn(nodes);
  };
  let inline = [];
  const flush = () => {
    // Whitespace between blocks is not a line; a top-level <br> or any text is.
    const bare = inline.every(
      (n) => n.nodeType === TEXT_NODE && /^[ \t\n\r\f]*$/.test(n.data)
    );
    if (!bare) line(inline);
    inline = [];
  };
  for (const node of parseHtml(html).childNodes) {
    if (node.nodeType === ELEMENT_NODE && BLOCK.has(node.tagName)) {
      flush();
      line([node]);
    } else if (node.nodeType === ELEMENT_NODE || node.nodeType === TEXT_NODE) {
      inline.push(node);
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
  const shown = total - counts.empty - counts.whitespace;
  return { ...counts, brs, nestedP, total, shown };
}

// One poem's line counts, raw final frame and conversion.
function censusOf(old, convertMidstFile) {
  const frames = JSON.parse(old).editorTimelineFrames;
  return {
    raw: linesOf(frames[frames.length - 1].content),
    converted: linesOf(JSON.parse(convertMidstFile(old)).text, true),
  };
}

const differs = (c) =>
  [...CLASSES, 'brs'].some((k) => c.raw[k] !== c.converted[k]);
const row = (x) =>
  `shown ${x.shown} of ${x.total} (empty ${x.empty}, whitespace ${x.whitespace}, blank ${x.blank}, zero-width ${x.zeroWidth}, text ${x.text}), <br> in text ${x.brs}`;

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
        if (c.converted.shown > c.raw.shown) t.gained += 1;
        if (c.converted.shown < c.raw.shown) t.lost += 1;
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
  console.log(`  with more lines shown converted   ${t.gained}`);
  console.log(`  with fewer lines shown converted  ${t.lost}`);
  console.log(`poems whose raw frame nests a <p>   ${t.nestedP}`);
  console.log(`files that failed                   ${failed}`);
  for (const [cls, n] of errors) console.log(`  ${cls}: ${n}`);
  console.log(`log: ${logFile}`);
  return failed ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { linesOf, censusOf, main };
