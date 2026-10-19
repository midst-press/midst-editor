/**
 * @jest-environment node
 */
// tools/tab_census.cjs (GitHub #17). Synthetic old-format files through the real vendored converter; no archive poem.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { countTabs, censusOf, main } = require('../tab_census.cjs');
const {
  convertMidstFile,
} = require('../../vendor/midst-format/convert/index.cjs');

const SCRIPT = path.join(__dirname, '..', 'tab_census.cjs');
const T0 = 1600000000000;
const oldFile = (...contents) =>
  JSON.stringify({
    editorTimelineFrames: contents.map((content, i) => ({
      content,
      lineNumber: '0',
      timestamp: T0 + i * 100,
    })),
  });

const STYLED = '<p><span style="white-space: pre;">zq\txv</span></p>';
const PLAIN = '<p>\tzq&#9;xv&#x9;wj&Tab;</p>';

describe('countTabs', () => {
  it('counts literal tabs and every character reference for one, split by the inline white-space', () => {
    expect(countTabs(STYLED + PLAIN)).toEqual({ styled: 1, plain: 4 });
  });

  it('takes the nearest white-space, so a normal span inside a pre one is plain', () => {
    expect(
      countTabs(
        '<p style="white-space:pre-wrap">a\tb<span style="white-space: normal">c\td</span></p>'
      )
    ).toEqual({ styled: 1, plain: 1 });
  });

  it('counts only text inside a <p>', () => {
    expect(countTabs('\t<p>a</p>\t<div>\t</div>')).toEqual({
      styled: 0,
      plain: 0,
    });
  });
});

describe('censusOf, with the real converter', () => {
  it('finds every tab of the final frame, styled and plain, in the conversion', () => {
    expect(
      censusOf(oldFile('<p>zq</p>', STYLED + PLAIN), convertMidstFile)
    ).toEqual({ styled: 1, plain: 4, converted: 5 });
  });

  it('reports fewer converted tabs when a converter drops them', () => {
    const dropping = (old) =>
      JSON.stringify({
        text: JSON.parse(convertMidstFile(old)).text.replace(/\t/g, ' '),
      });
    expect(censusOf(oldFile(STYLED + PLAIN), dropping)).toEqual({
      styled: 1,
      plain: 4,
      converted: 0,
    });
  });
});

describe('the command', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-census-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = () => {
    const log = path.join(dir, 'census.log');
    const r = spawnSync('node', [SCRIPT, dir, '--log', log], {
      encoding: 'utf8',
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  it('prints counts and poem numbers only, and exits 0 when every tab survives', () => {
    fs.writeFileSync(path.join(dir, 'b.midst'), oldFile('<p>zq</p>'));
    fs.writeFileSync(path.join(dir, 'a.midst'), oldFile(STYLED + PLAIN));
    const r = run();
    expect(r.status).toBe(0);
    expect(r.out).toContain('P1  raw 5 (styled 1, plain 4)  converted 5\n');
    expect(r.out).not.toContain('P2 ');
    expect(r.out).toMatch(/poems with fewer tabs converted\s+0/);
    expect(r.out).not.toMatch(/zq|xv|a\.midst/);
  });

  it('marks a poem that loses a tab and exits 1', () => {
    fs.writeFileSync(path.join(dir, 'a.midst'), oldFile(STYLED + PLAIN));
    const dropping = (old) =>
      JSON.stringify({
        text: JSON.parse(convertMidstFile(old)).text.replace(/\t/g, ' '),
      });
    const lines = [];
    const spy = jest
      .spyOn(console, 'log')
      .mockImplementation((line) => lines.push(line));
    try {
      expect(
        main(['node', SCRIPT, dir, '--log', path.join(dir, 'l')], dropping)
      ).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(lines).toContain('P1  raw 5 (styled 1, plain 4)  converted 0  LOST');
    expect(lines.join('\n')).toMatch(/poems with fewer tabs converted\s+1/);
  });

  it('counts a file that cannot be read by error class, and exits 1', () => {
    fs.writeFileSync(path.join(dir, 'a.midst'), '{not json');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain('file 1: SyntaxError');
    expect(r.out).toMatch(/files that failed\s+1/);
  });

  it('refuses a missing directory with 2', () => {
    const r = spawnSync('node', [SCRIPT, path.join(dir, 'none')], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
  });
});
