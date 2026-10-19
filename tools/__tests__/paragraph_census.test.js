/**
 * @jest-environment node
 */
// tools/paragraph_census.cjs (GitHub #169). Synthetic old-format files through the real vendored converter.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { linesOf, censusOf, main } = require('../paragraph_census.cjs');
const {
  convertMidstFile,
} = require('../../vendor/midst-format/convert/index.cjs');

const SCRIPT = path.join(__dirname, '..', 'paragraph_census.cjs');
const oldFile = (content) =>
  JSON.stringify({
    editorTimelineFrames: [
      { content, lineNumber: '0', timestamp: 1600000000000 },
    ],
  });
const lines = (counts) => ({
  empty: 0,
  whitespace: 0,
  zeroWidth: 0,
  text: 0,
  nestedP: 0,
  ...counts,
});

describe('linesOf', () => {
  it('parses as a browser does: a <p> inside a <p> closes the first, and the stray </p> makes an empty one', () => {
    expect(linesOf('<p>zq<p>xv</p></p>')).toEqual(
      lines({ text: 2, empty: 1, nestedP: 1, total: 3 })
    );
  });

  it('counts a top-level run of inline text as a line, and whitespace between blocks as none', () => {
    expect(linesOf('<p>zq</p>\n xv <b>wj</b>\n<p>zq</p>')).toEqual(
      lines({ text: 3, total: 3 })
    );
  });

  it('classes each line: empty, whitespace, zero-width (with or without spaces around it), text', () => {
    expect(
      linesOf(
        '<p></p><p> \u00a0</p><p><span><span>\u200b</span></span></p><p> \ufeff </p><p>zq</p>'
      )
    ).toEqual(
      lines({ empty: 1, whitespace: 1, zeroWidth: 2, text: 1, total: 5 })
    );
  });
});

describe('censusOf, with the real converter', () => {
  it('an ordinary poem has the same lines before and after', () => {
    const c = censusOf(oldFile('<p>zq</p>\n<p>xv</p>'), convertMidstFile);
    expect(c.converted).toEqual(c.raw);
  });

  it('a marker wrapped in a marker keeps its line, as an empty paragraph', () => {
    const c = censusOf(
      oldFile('<p>zq</p><p><span><span>\u200b</span></span></p><p>xv</p>'),
      convertMidstFile
    );
    expect(c.raw).toEqual(lines({ zeroWidth: 1, text: 2, total: 3 }));
    expect(c.converted).toEqual(lines({ empty: 1, text: 2, total: 3 }));
  });

  it('a nested <p> is seen: the browser showed two lines of text, and the conversion has one', () => {
    const c = censusOf(oldFile('<p>zq<p>xv</p></p>'), convertMidstFile);
    expect(c.raw.text).toBe(2);
    expect(c.raw.nestedP).toBe(1);
    expect(c.converted.text).toBe(1);
  });
});

describe('the command', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paragraph-census-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const capture = (fn) => {
    const out = [];
    const log = jest
      .spyOn(console, 'log')
      .mockImplementation((l) => out.push(l));
    const err = jest
      .spyOn(console, 'error')
      .mockImplementation((l) => out.push(l));
    try {
      return { status: fn(), out: out.join('\n') };
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  };
  const run = (convert) =>
    capture(() =>
      main(['node', SCRIPT, dir, '--log', path.join(dir, 'l')], convert)
    );

  it('prints nothing per poem when the lines match, and only counts', () => {
    fs.writeFileSync(path.join(dir, 'a.midst'), oldFile('<p>zq</p><p>xv</p>'));
    const r = run();
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch(/^P\d/m);
    expect(r.out).toMatch(/poems whose line classes differ\s+0/);
    expect(r.out).not.toMatch(/zq|xv|a\.midst/);
  });

  it('prints both rows for a poem that gains a line, and counts it', () => {
    fs.writeFileSync(path.join(dir, 'a.midst'), oldFile('<p>zq</p>'));
    fs.writeFileSync(path.join(dir, 'b.midst'), oldFile('<p>zq</p>'));
    const gaining = (old) =>
      JSON.stringify({
        text: `${JSON.parse(convertMidstFile(old)).text}<p></p>`,
      });
    const r = run(gaining);
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      'P1  raw total 1 (empty 0, whitespace 0, zero-width 0, text 1), nested <p> 0'
    );
    expect(r.out).toContain(
      'P1  converted total 2 (empty 1, whitespace 0, zero-width 0, text 1)'
    );
    expect(r.out).toMatch(/with more lines converted\s+2/);
  });

  it('counts a file that cannot be read by error class, and exits 1', () => {
    fs.writeFileSync(path.join(dir, 'a.midst'), '{not json');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain('file 1: SyntaxError');
  });

  it('refuses a missing directory with 2', () => {
    const r = spawnSync('node', [SCRIPT, path.join(dir, 'none')], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
  });
});
