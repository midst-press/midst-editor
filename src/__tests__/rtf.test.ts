/** @jest-environment node */
import { docToRtf, poemToRtf, rtfText } from '../main/rtf';

// Synthetic text only: invented words, never a poem.

// The body of an exported file: everything between the header and the closing brace.
const body = (html: string) => {
  const result = poemToRtf(html);
  if (!result.ok) throw new Error(result.reason);
  const start = result.rtf.indexOf('\\fs24\n') + '\\fs24\n'.length;
  expect(result.rtf.endsWith('}\n')).toBe(true);
  return result.rtf.slice(start, -2);
};

describe('poemToRtf (GitHub #26)', () => {
  it('starts as an RTF file and names a font every reader has', () => {
    const result = poemToRtf('<p>zq</p>');
    expect(result.ok && result.rtf.startsWith('{\\rtf1\\ansi')).toBe(true);
    expect(result.ok && result.rtf).toContain('Helvetica{\\*\\falt Arial}');
  });

  it('writes each paragraph as a paragraph, an empty one included, so stanza breaks stay', () => {
    expect(body('<p>zq</p><p></p><p>xv</p>')).toBe('zq\\par\n\\par\nxv\\par\n');
  });

  it('writes a line break inside a paragraph as a line break', () => {
    expect(body('<p>zq<br>xv</p>')).toBe('zq\\line xv\\par\n');
  });

  it('carries bold, italic and both', () => {
    expect(
      body(
        '<p><strong>zq</strong> <em>xv</em> <strong><em>wk</em></strong></p>'
      )
    ).toBe('{\\b zq} {\\i xv} {\\b\\i wk}\\par\n');
  });

  it('keeps leading spaces, runs of spaces and tabs, as the editor shows them', () => {
    expect(body('<p>  zq   xv\twk</p>')).toBe('  zq   xv\\tab wk\\par\n');
  });

  it.each(['', '<p></p>', '<p></p><p><br></p>'])(
    'refuses an empty poem (%j), and says why',
    (html) => {
      expect(poemToRtf(html)).toEqual({
        ok: false,
        reason: 'The poem is empty, so there is nothing to export.',
      });
    }
  );
});

describe('rtfText', () => {
  it('escapes the characters RTF reserves', () => {
    expect(rtfText('a\\b{c}d')).toBe('a\\\\b\\{c\\}d');
  });

  it('writes characters beyond ASCII as \\u with the signed code unit, and beyond the BMP as two', () => {
    expect(rtfText('é')).toBe('\\u233?');
    expect(rtfText('\uffe9')).toBe('\\u-23?');
    expect(rtfText('😀')).toBe('\\u-10179?\\u-8704?');
  });

  it('drops nothing: a line ending is a line break, any other control character its hex escape', () => {
    expect(rtfText('a\r\nb\rc\nd')).toBe('a\\line b\\line c\\line d');
    expect(rtfText('a\u000bb\u007fc')).toBe("a\\'0bb\\'7fc");
  });
});

describe('docToRtf refuses what RTF here cannot carry, naming it', () => {
  it('a node that is not a paragraph', () => {
    const result = docToRtf({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'zq' }] },
        { type: 'bulletList', content: [{ type: 'text', text: 'xv' }] },
      ],
    });
    expect(result).toEqual({
      ok: false,
      reason:
        'The poem contains "bulletList", which Midst cannot write to an RTF file. Nothing was exported.',
    });
  });

  it('a mark that is not bold or italic', () => {
    const result = docToRtf({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'zq', marks: [{ type: 'underline' }] },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('"underline" formatting');
  });

  it('a node inside a line that is not text or a line break', () => {
    const result = docToRtf({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'zq' }, { type: 'image' }],
        },
      ],
    });
    expect(!result.ok && result.reason).toContain('"image" inside a line');
  });
});
