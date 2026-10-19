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
const lines = (counts) => {
  const all = {
    empty: 0,
    whitespace: 0,
    blank: 0,
    zeroWidth: 0,
    text: 0,
    brs: 0,
    nestedP: 0,
    ...counts,
  };
  const total =
    all.empty + all.whitespace + all.blank + all.zeroWidth + all.text;
  return { ...all, total, shown: total - all.empty - all.whitespace };
};

describe('linesOf', () => {
  it('parses as a browser does: a <p> inside a <p> closes the first, and the stray </p> makes an empty one', () => {
    expect(linesOf('<p>zq<p>xv</p></p>')).toEqual(
      lines({ text: 2, empty: 1, nestedP: 1 })
    );
  });

  it('counts a top-level run of inline text as a line, and whitespace between blocks as none', () => {
    expect(linesOf('<p>zq</p>\n xv <b>wj</b>\n<p>zq</p>')).toEqual(
      lines({ text: 3 })
    );
  });

  it('classes each line by what a browser draws: empty and collapsible whitespace have no height', () => {
    expect(linesOf('<p></p>')).toEqual(lines({ empty: 1 }));
    expect(linesOf('<p> \t</p>')).toEqual(lines({ whitespace: 1 }));
  });

  // cyril-9137f1ee and silas-397300f6, review of #227: each of these is a blank line the poet saw.
  it.each([
    ['a <br>', '<p><br></p>'],
    ['a no-break space', '<p>&nbsp;</p>'],
    [
      'spaces under a preserving white-space',
      '<p><span style="white-space: pre">  </span></p>',
    ],
    ['a <br> between blocks', '<p>zq</p><br><p>xv</p>'],
    [
      'a newline under pre-line',
      '<p><span style="white-space: pre-line">\n</span></p>',
    ],
  ])('a visible blank line: %s', (_name, html) => {
    expect(linesOf(html).blank).toBe(1);
    expect(linesOf(html).empty + linesOf(html).whitespace).toBe(0);
  });

  it('classes zero-width lines, with or without spaces around them, apart from text', () => {
    expect(
      linesOf('<p><span><span>\u200b</span></span></p><p> \ufeff </p><p>zq</p>')
    ).toEqual(lines({ zeroWidth: 2, text: 1 }));
  });

  it('pre-line collapses spaces and tabs, so spaces under it draw nothing', () => {
    expect(
      linesOf('<p><span style="white-space: pre-line"> \t </span></p>')
    ).toEqual(lines({ whitespace: 1 }));
  });

  it.each([
    ['a trailing <br>', '<p>zq<br></p>', 0],
    ['a trailing <br> before collapsible space', '<p>zq<br> </p>', 0],
    ['a <br> before text in its block', '<p><span>zq<br></span>xv</p>', 1],
    ['a <br> before another <br>', '<p>zq<br><br></p>', 1],
  ])('counts a <br> only when something follows it: %s', (_name, html, n) => {
    expect(linesOf(html).brs).toBe(n);
  });

  it('counts the <br>s inside text lines, which are line breaks within one paragraph', () => {
    expect(linesOf('<p>zq<br>xv<br>wj</p><p><br></p>')).toEqual(
      lines({ text: 1, blank: 1, brs: 2 })
    );
  });

  it('in the new editor an empty paragraph is a blank line it draws', () => {
    expect(linesOf('<p></p><p> </p>', true)).toEqual(lines({ blank: 2 }));
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
    expect(c.raw).toEqual(lines({ zeroWidth: 1, text: 2 }));
    expect(c.converted).toEqual(lines({ blank: 1, text: 2 }));
  });

  it('a raw empty paragraph, which showed nothing, becomes a line the new editor shows', () => {
    const c = censusOf(oldFile('<p>zq</p><p></p><p>xv</p>'), convertMidstFile);
    expect(c.raw).toEqual(lines({ text: 2, empty: 1 }));
    expect(c.converted.shown).toBe(c.raw.shown + 1);
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
      'P1  raw shown 1 of 1 (empty 0, whitespace 0, blank 0, zero-width 0, text 1), <br> in text 0, nested <p> 0'
    );
    expect(r.out).toContain(
      'P1  converted shown 2 of 2 (empty 0, whitespace 0, blank 1, zero-width 0, text 1), <br> in text 0'
    );
    expect(r.out).toMatch(/with more lines shown converted\s+2/);
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
