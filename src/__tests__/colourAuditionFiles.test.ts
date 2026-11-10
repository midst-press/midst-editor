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

jest.mock('electron', () => ({ dialog: {}, ipcMain: { on: jest.fn() } }));
// eslint-disable-next-line import/first -- after the mock it needs
import {
  ColourFileDeps,
  MAX_IMPORT_BYTES,
  exportColours,
  importColours,
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
      expect(result.ok).toBe(false);
      expect(write).not.toHaveBeenCalled();
    }
  );

  it('does nothing when the dialog is cancelled', () => {
    const write = jest.fn();
    expect(
      exportColours(deps({ save: () => undefined, write }), 'text')
    ).toEqual({ ok: false, reason: 'cancelled' });
    expect(write).not.toHaveBeenCalled();
  });

  it('says why when it cannot write', () => {
    const write = () => {
      throw new Error('disk full');
    };
    expect(exportColours(deps({ write }), 'text')).toEqual({
      ok: false,
      reason: 'Could not save: disk full',
    });
  });
});

describe('importing a colour set', () => {
  it.each(['/x/My poem.midst', '/x/LOUD.MIDST'])(
    'never reads a poem: %s',
    (source) => {
      const read = jest.fn();
      const result = importColours(deps({ open: () => [source], read }));
      expect(result.ok).toBe(false);
      expect(read).not.toHaveBeenCalled();
    }
  );

  it('refuses a file too large to be a colour set, without reading it', () => {
    const read = jest.fn();
    expect(
      importColours(deps({ size: () => MAX_IMPORT_BYTES + 1, read })).ok
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('does nothing when the dialog is cancelled', () => {
    expect(importColours(deps({ open: () => undefined }))).toEqual({
      ok: false,
      reason: 'cancelled',
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
