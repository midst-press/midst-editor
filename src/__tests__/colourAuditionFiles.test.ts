/**
 * @jest-environment node
 */
/* eslint-disable lingui/no-unlocalized-strings -- the audition tool is English only (GitHub #119) */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AUDITION_COLOURS,
  parseHexList,
} from '../renderer/colourAudition/colours';

const mockDialog = { showOpenDialogSync: jest.fn() };
// eslint-disable-next-line no-unused-vars -- parameters named in a function type
type Handler = (...args: unknown[]) => void;
const mockHandlers: Record<string, Handler> = {};
jest.mock('electron', () => ({
  dialog: mockDialog,
  ipcMain: {
    on: (channel: string, handler: Handler) => {
      mockHandlers[channel] = handler;
    },
  },
}));
// eslint-disable-next-line import/first -- after the mock it needs
import {
  ColourFileDeps,
  MAX_IMPORT_BYTES,
  MAX_LOGO_BYTES,
  exportColours,
  importColours,
  registerColourFiles,
  writeReplacing,
} from '../main/colourAudition';

// View > Colours… saving and reading a colour set (GitHub #119). A colour set is never a poem: a .midst path is
// refused both ways, so this can neither write over a poem nor read one.

const deps = (over: Partial<ColourFileDeps> = {}): ColourFileDeps => ({
  save: () => '/x/Midst colours.txt',
  open: () => ['/x/Midst colours.txt'],
  write: jest.fn(),
  size: () => 10,
  read: () => 'Midst colours, Light',
  ...over,
});

describe('exporting a colour set', () => {
  it('writes the text where the Save dialog says', () => {
    const write = jest.fn();
    expect(exportColours(deps({ write }), 'text')).toEqual({
      ok: true,
      path: '/x/Midst colours.txt',
    });
    expect(write).toHaveBeenCalledWith('/x/Midst colours.txt', 'text');
  });

  it.each(['/x/My poem.midst', '/x/LOUD.MIDST'])(
    'never writes over a poem: %s',
    (target) => {
      const write = jest.fn();
      const result = exportColours(deps({ save: () => target, write }), 'text');
      expect(result).toEqual({ ok: false, failure: 'poem' });
      expect(write).not.toHaveBeenCalled();
    }
  );

  it('does nothing when the dialog is cancelled', () => {
    const write = jest.fn();
    expect(
      exportColours(deps({ save: () => undefined, write }), 'text')
    ).toEqual({ ok: false, failure: 'cancelled' });
    expect(write).not.toHaveBeenCalled();
  });

  it('says why when it cannot write', () => {
    const write = () => {
      throw new Error('disk full');
    };
    expect(exportColours(deps({ write }), 'text')).toEqual({
      ok: false,
      failure: 'unwritable',
      error: 'disk full',
    });
  });
});

describe('importing a colour set', () => {
  it.each(['/x/My poem.midst', '/x/LOUD.MIDST'])(
    'never reads a poem: %s',
    (source) => {
      const read = jest.fn();
      const result = importColours(deps({ open: () => [source], read }));
      expect(result).toEqual({ ok: false, failure: 'poem' });
      expect(read).not.toHaveBeenCalled();
    }
  );

  it('refuses a file too large to be a colour set, without reading it', () => {
    const read = jest.fn();
    expect(
      importColours(deps({ size: () => MAX_IMPORT_BYTES + 1, read }))
    ).toEqual({ ok: false, failure: 'tooLarge' });
    expect(read).not.toHaveBeenCalled();
  });

  it('does nothing when the dialog is cancelled', () => {
    expect(importColours(deps({ open: () => undefined }))).toEqual({
      ok: false,
      failure: 'cancelled',
    });
  });

  // Violet's compatibility test, from a real file: what Frida has today (the 90d71ee build, one tab pasted into a
  // file by hand, old labels, no ids) imports completely.
  it('imports a 90d71ee export from a file, completely', () => {
    const OLD: Record<string, string> = {
      primaryDark: 'Primary, darker',
      logo: 'Logo',
    };
    const hex = (i: number) =>
      `#${(0x100000 + i * 0x0a0b0c).toString(16).slice(-6)}`;
    const text = [
      'Midst colours, Dark',
      ...AUDITION_COLOURS.map(
        (c, i) => `${c.group} / ${OLD[c.id] ?? c.label}: ${hex(i)}`
      ),
    ].join('\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colour-set-'));
    const file = path.join(dir, 'Frida 1.txt');
    try {
      fs.writeFileSync(file, text, 'utf8');
      const result = importColours({
        ...deps(),
        open: () => [file],
        size: (p) => fs.statSync(p).size,
        read: (p) => fs.readFileSync(p, 'utf8'),
      });
      expect(result.ok).toBe(true);
      const read = parseHexList(result.ok ? (result.text ?? '') : '');
      expect(read.problems).toEqual([]);
      expect(read.colours.dark).toEqual(
        Object.fromEntries(AUDITION_COLOURS.map((c, i) => [c.id, hex(i)]))
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Alden's finding on #486: a .txt that is another name for a poem must not let Export write over the poem. Real
// files, in a folder made for the test.
describe('exporting onto another name for a poem', () => {
  let dir: string;
  let poem: string;
  let target: string;
  const SENTINEL = 'a poem, which must survive';
  const real = (over: Partial<ColourFileDeps> = {}): ColourFileDeps => ({
    save: () => target,
    open: () => [target],
    write: writeReplacing,
    size: (p) => fs.statSync(p).size,
    read: (p) => fs.readFileSync(p, 'utf8'),
    ...over,
  });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-colours-'));
    poem = path.join(dir, 'My poem.midst');
    target = path.join(dir, 'Midst colours.txt');
    fs.writeFileSync(poem, SENTINEL);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each([
    ['a symbolic link', fs.symlinkSync],
    ['a hard link', fs.linkSync],
  ])('leaves the poem as it was when the .txt is %s to it', (_kind, link) => {
    link(poem, target);
    expect(fs.statSync(target).ino).toBe(fs.statSync(poem).ino);
    expect(exportColours(real(), 'colour text')).toEqual({
      ok: true,
      path: target,
    });
    expect(fs.readFileSync(poem, 'utf8')).toBe(SENTINEL);
    expect(fs.readFileSync(target, 'utf8')).toBe('colour text');
    expect(fs.readdirSync(dir).sort()).toEqual([
      'Midst colours.txt',
      'My poem.midst',
    ]);
  });

  it('replaces an ordinary colour file, and creates a new one', () => {
    fs.writeFileSync(target, 'old colours');
    expect(exportColours(real(), 'new colours').ok).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('new colours');
    fs.rmSync(target);
    expect(exportColours(real(), 'fresh').ok).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('fresh');
  });

  it('leaves no temporary file behind when the rename fails', () => {
    fs.mkdirSync(target); // a folder cannot be renamed over by a file
    expect(exportColours(real(), 'colour text')).toMatchObject({
      ok: false,
      failure: 'unwritable',
    });
    expect(fs.readdirSync(dir).sort()).toEqual([
      'Midst colours.txt',
      'My poem.midst',
    ]);
    expect(fs.readFileSync(poem, 'utf8')).toBe(SENTINEL);
  });
});

// GitHub #119: a replacement logo is read through main's Open dialog, SVG only, with the same refusals as a colour
// set and a larger cap. Through the registered handler, as the panel reaches it.
describe('reading a replacement logo', () => {
  let dir: string;
  const words = { filterName: 'SVG drawing', defaultName: 'Midst logo.svg' };
  const read = (chosen: string) => {
    mockDialog.showOpenDialogSync.mockReturnValue([chosen]);
    const event: { returnValue?: unknown } = {};
    mockHandlers['colours-logo'](event, words);
    return event.returnValue;
  };
  beforeAll(() => registerColourFiles(() => ({}) as never));
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-logo-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('asks for an SVG, and reads one larger than a colour set may be', () => {
    const file = path.join(dir, 'logo.svg');
    const text = `<svg>${'x'.repeat(MAX_IMPORT_BYTES)}</svg>`;
    fs.writeFileSync(file, text);
    expect(read(file)).toEqual({ ok: true, path: file, text });
    expect(mockDialog.showOpenDialogSync).toHaveBeenLastCalledWith(
      expect.anything(),
      {
        properties: ['openFile'],
        filters: [{ name: 'SVG drawing', extensions: ['svg'] }],
      }
    );
  });

  it('refuses a poem, and a file too large to be a logo, reading neither', () => {
    const poem = path.join(dir, 'My poem.midst');
    fs.writeFileSync(poem, 'a poem');
    expect(read(poem)).toEqual({ ok: false, failure: 'poem' });
    const big = path.join(dir, 'big.svg');
    fs.writeFileSync(big, 'x'.repeat(MAX_LOGO_BYTES + 1));
    expect(read(big)).toEqual({ ok: false, failure: 'tooLarge' });
  });

  it('refuses a request without its words', () => {
    const event: { returnValue?: unknown } = {};
    mockHandlers['colours-logo'](event, undefined);
    expect(event.returnValue).toEqual({ ok: false, failure: 'unavailable' });
  });
});
