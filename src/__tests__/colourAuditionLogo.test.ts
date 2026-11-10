/* eslint-disable lingui/no-unlocalized-strings -- the audition tool is English only (GitHub #119) */
// View > Colours… auditioning the squiggly M (GitHub #119). Synthetic drawings only, and the app's own logo file.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  LOGO_STORAGE_KEY,
  NO_LOGO_CHANGE,
  drawLogo,
  forgetOriginalLogo,
  loadLogo,
  logoCss,
  readLogo,
  saveLogo,
} from '../renderer/colourAudition/logo';

const APP_LOGO = readFileSync(
  join(__dirname, '..', '..', 'assets', 'midst-logo.svg'),
  'utf8'
);
const svg = (inner: string, attrs = 'viewBox="0 0 10 10"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe('reading a replacement logo', () => {
  it("reads the app's own logo file", () => {
    const read = readLogo(APP_LOGO);
    expect(read.problems).toEqual([]);
    expect(read.logo?.viewBox).toBe('0 0 182.2 96');
    expect(read.logo?.paths).toHaveLength(1);
    expect(read.logo?.paths[0]).toMatch(/^M22\.51,82\.3/);
  });

  it.each([
    ['not XML', 'just words'],
    ['not an SVG', '<html><body><path d="M0 0"/></body></html>'],
    ['an SVG with no paths', svg('<circle r="3"/>')],
    ['an SVG with no size', svg('<path d="M0 0L1 1"/>', '')],
  ])('refuses %s, saying why', (_kind, text) => {
    const read = readLogo(text);
    expect(read.logo).toBeNull();
    expect(read.problems).toHaveLength(1);
  });

  it('sizes a drawing by its width and height when it has no viewBox', () => {
    expect(
      readLogo(svg('<path d="M0 0L1 1"/>', 'width="40px" height="20"')).logo
        ?.viewBox
    ).toBe('0 0 40 20');
  });

  // A file must not bring anything but path data into the window.
  it('keeps only path data, whatever else the file holds', () => {
    const read = readLogo(
      svg(
        '<script>window.zq = 1</script>' +
          '<style>path { fill: red }</style>' +
          '<a href="https://example.invalid"><path d="M1 1L2 2" onclick="window.zq = 2"/></a>' +
          '<path d="M0 0" style="fill: red" class="zq"/>' +
          '<path d="url(javascript:alert(1))"/>' +
          '<path d="M0 0 expression(1)"/>' +
          '<foreignObject><div>xv</div></foreignObject>'
      )
    );
    expect(read.logo?.paths).toEqual(['M1 1L2 2', 'M0 0']);
    expect(read.problems).toEqual([
      '2 path(s) could not be read and were left out.',
    ]);
  });

  it('says what it left out: shapes that are not paths, and transforms', () => {
    const read = readLogo(
      svg(
        '<g transform="scale(2)"><path d="M0 0L1 1"/></g><rect width="1" height="1"/><circle r="1"/>'
      )
    );
    expect(read.logo?.paths).toEqual(['M0 0L1 1']);
    expect(read.problems).toEqual([
      '2 shape(s) that are not paths were left out. Convert them to paths to see them.',
      'The drawing has transforms, which were ignored, so it may be placed differently.',
    ]);
  });
});

describe('drawing it in the page', () => {
  const APP = `<svg id="svg" class="svg hide" viewBox="0 0 182.2 96"><path d="M5 5" id="path1786"></path></svg>`;
  beforeEach(() => {
    forgetOriginalLogo();
    document.body.innerHTML = `<div>${APP}</div><p>xv</p>`;
  });

  it("draws a replacement's paths in fresh elements, and puts the app's own back exactly", () => {
    drawLogo(document, { viewBox: '0 0 10 10', paths: ['M0 0L1 1', 'M2 2'] });
    const drawn = document.getElementById('svg')!;
    expect(drawn.getAttribute('viewBox')).toBe('0 0 10 10');
    expect(drawn.getAttribute('class')).toBe('svg hide');
    expect(
      Array.from(drawn.children).map((c) => [c.localName, c.attributes.length])
    ).toEqual([
      ['path', 1],
      ['path', 1],
    ]);
    drawLogo(document, { viewBox: '0 0 4 4', paths: ['M3 3'] });
    drawLogo(document, null);
    expect(document.getElementById('svg')!.outerHTML).toBe(APP);
  });

  it('changes nothing when the logo is put back before it was ever replaced', () => {
    drawLogo(document, null);
    expect(document.getElementById('svg')!.outerHTML).toBe(APP);
  });
});

describe('the outline', () => {
  it('is no CSS at all at 0', () => expect(logoCss(0)).toBe(''));

  it("is a stroke in the logo's own colour", () => {
    expect(logoCss(2.5)).toBe(
      ':root:root .svg path { stroke: var(--midst-primary-dark); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }'
    );
  });
});

describe('keeping it across a restart', () => {
  const store = (value: unknown) => ({
    getItem: (key: string) =>
      key === LOGO_STORAGE_KEY ? JSON.stringify(value) : null,
  });

  it('keeps a replacement and an outline', () => {
    const kept: Record<string, string> = {};
    const state = {
      custom: { viewBox: '0 0 10 10', paths: ['M0 0L1 1'] },
      outline: 2,
    };
    saveLogo(
      {
        setItem: (k, v) => {
          kept[k] = v;
        },
      },
      state
    );
    expect(loadLogo({ getItem: (k) => kept[k] ?? null })).toEqual(state);
  });

  it.each([
    ['nothing kept', null],
    ['not JSON', undefined],
    [
      'a path that is not path data',
      { custom: { viewBox: '0 0 1 1', paths: ['M0 0', '<script>'] } },
    ],
    [
      'a viewBox that is not one',
      { custom: { viewBox: '0 0 1', paths: ['M0 0'] } },
    ],
    ['no paths', { custom: { viewBox: '0 0 1 1', paths: [] } }],
    ['an outline out of range', { outline: 99 }],
    ['an outline that is not a number', { outline: '2' }],
  ])(
    'starts from the app’s own logo when what was kept is %s',
    (_kind, value) => {
      const storage =
        value === undefined ? { getItem: () => '{not json' } : store(value);
      expect(loadLogo(storage)).toEqual(NO_LOGO_CHANGE);
    }
  );
});
