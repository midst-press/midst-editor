/* eslint-disable lingui/no-unlocalized-strings -- an audition tool for Annelyse and Frida (GitHub #119), in English
   only and never in a release; see README.md in this folder */

// View > Colours…: auditioning the squiggly M (GitHub #119). The app's logo is assets/midst-logo.svg, which
// preload.ts puts in the page as #svg. Here a replacement can be read from a file, drawn in its place, given an
// outline in its own colour, and put back.
//
// A replacement is never put in the page as it came. Only its viewBox and its paths' `d` are kept, each checked
// against what those may hold, and drawn into fresh elements, so a file cannot bring a script, an event handler,
// a link or a style into the window. The logo keeps its colour from App.css. What is left out is reported.

export interface Logo {
  viewBox: string;
  paths: string[];
}

export interface LogoState {
  // A replacement drawn in place of the app's own, or none.
  custom: Logo | null;
  // The outline's width, in the drawing's own units; 0 is none.
  outline: number;
}

export const NO_LOGO_CHANGE: LogoState = { custom: null, outline: 0 };
export const MAX_OUTLINE = 6;

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const VIEWBOX = new RegExp(`^\\s*${NUMBER}(?:[\\s,]+${NUMBER}){3}\\s*$`);
// Path data is commands, numbers and separators, nothing else.
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;

const isViewBox = (v: unknown): v is string =>
  typeof v === 'string' && VIEWBOX.test(v);
const isPath = (d: unknown): d is string =>
  typeof d === 'string' && d.trim() !== '' && PATH_DATA.test(d);

// Elements a drawing can be made of that this does not draw.
const LEFT_OUT = [
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'rect',
  'text',
  'image',
  'use',
];

export interface ReadLogo {
  logo: Logo | null;
  problems: string[];
}

export const readLogo = (text: string): ReadLogo => {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (
    doc.getElementsByTagName('parsererror').length > 0 ||
    root.localName !== 'svg'
  )
    return { logo: null, problems: ['That file is not an SVG drawing.'] };
  const problems: string[] = [];
  let viewBox = root.getAttribute('viewBox') ?? '';
  if (!isViewBox(viewBox)) {
    const width = parseFloat(root.getAttribute('width') ?? '');
    const height = parseFloat(root.getAttribute('height') ?? '');
    if (!(width > 0 && height > 0))
      return {
        logo: null,
        problems: [
          'The drawing has no viewBox, or width and height, to size it by.',
        ],
      };
    viewBox = `0 0 ${width} ${height}`;
  }
  const all = Array.from(root.getElementsByTagName('*'));
  const paths: string[] = [];
  let unreadable = 0;
  all
    .filter((el) => el.localName === 'path')
    .forEach((el) => {
      const d = el.getAttribute('d');
      if (isPath(d)) paths.push(d.trim());
      else unreadable += 1;
    });
  if (paths.length === 0)
    return { logo: null, problems: ['The drawing has no paths to draw.'] };
  if (unreadable > 0)
    problems.push(`${unreadable} path(s) could not be read and were left out.`);
  const shapes = all.filter((el) => LEFT_OUT.includes(el.localName)).length;
  if (shapes > 0)
    problems.push(
      `${shapes} shape(s) that are not paths were left out. Convert them to paths to see them.`
    );
  if (all.some((el) => el.hasAttribute('transform')))
    problems.push(
      'The drawing has transforms, which were ignored, so it may be placed differently.'
    );
  return { logo: { viewBox: viewBox.trim(), paths }, problems };
};

// ---- Drawing it ----------------------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
// The app's own logo, as preload.ts drew it, kept the first time it is replaced so it can be put back.
let original: { viewBox: string | null; children: Node[] } | null = null;

export const drawLogo = (doc: Document, logo: Logo | null) => {
  const svg = doc.getElementById('svg');
  if (!svg) return;
  if (!original) {
    if (!logo) return;
    original = {
      viewBox: svg.getAttribute('viewBox'),
      children: Array.from(svg.childNodes),
    };
  }
  if (!logo) {
    if (original.viewBox === null) svg.removeAttribute('viewBox');
    else svg.setAttribute('viewBox', original.viewBox);
    svg.replaceChildren(...original.children);
    return;
  }
  svg.setAttribute('viewBox', logo.viewBox);
  svg.replaceChildren(
    ...logo.paths.map((d) => {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      return path;
    })
  );
};

// For tests: forget the app's own logo, as a fresh window would.
export const forgetOriginalLogo = () => {
  original = null;
};

// The outline: a stroke in the logo's own colour, so its lines draw thicker (Frida, GitHub #119).
export const logoCss = (outline: number): string =>
  outline > 0
    ? `:root:root .svg path { stroke: var(--midst-primary-dark); stroke-width: ${outline}; stroke-linejoin: round; stroke-linecap: round; }`
    : '';

// ---- Keeping it -----------------------------------------------------------------------------------------

export const LOGO_STORAGE_KEY = 'midst.colourAudition.logo.v1';

// What was kept, checked as a file is, so a stored value can never put anything but path data in the page.
export const loadLogo = (storage: Pick<Storage, 'getItem'>): LogoState => {
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(LOGO_STORAGE_KEY) ?? 'null');
  } catch {
    return NO_LOGO_CHANGE;
  }
  if (!raw || typeof raw !== 'object') return NO_LOGO_CHANGE;
  const { custom, outline } = raw as Record<string, unknown>;
  const kept =
    custom && typeof custom === 'object'
      ? (custom as Record<string, unknown>)
      : null;
  const paths = Array.isArray(kept?.paths) ? kept.paths : [];
  return {
    custom:
      kept && isViewBox(kept.viewBox) && paths.length > 0 && paths.every(isPath)
        ? { viewBox: kept.viewBox, paths: paths as string[] }
        : null,
    outline:
      typeof outline === 'number' && outline > 0 && outline <= MAX_OUTLINE
        ? outline
        : 0,
  };
};

export const saveLogo = (
  storage: Pick<Storage, 'setItem'>,
  state: LogoState
) => {
  try {
    storage.setItem(LOGO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Full or refused: the change still applies to this window.
  }
};
