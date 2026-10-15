/** @jest-environment node */
import { getSchema } from '@tiptap/core';
import { generateJSON } from '@tiptap/html';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import poemExtensions from '../shared/poemExtensions';
import findInText from '../renderer/search/findInText';

const schema = getSchema(poemExtensions);

/** Build a document the way the editor does. */
function docOf(html: string): ProseMirrorNode {
  const json = generateJSON(html, poemExtensions, { preserveWhitespace: true });
  return schema.nodeFromJSON(json);
}

/** Run the search and check the oracle on every match: textBetween equals the expected text. */
function find(doc: ProseMirrorNode, query: string, expectedText: string) {
  const matches = findInText(doc, query);
  matches.forEach((m) => {
    expect(m.from).toBeGreaterThanOrEqual(0);
    expect(m.from).toBeLessThan(m.to);
    expect(m.to).toBeLessThanOrEqual(doc.content.size);
    expect(doc.textBetween(m.from, m.to)).toBe(expectedText);
  });
  return matches;
}

describe('findInText query partitions', () => {
  const doc = docOf('<p>zq qv</p>');

  it('FT-Q-1 empty query finds nothing', () => {
    expect(findInText(doc, '')).toEqual([]);
  });

  it('FT-Q-2 a query containing a newline finds nothing', () => {
    expect(findInText(docOf('<p>zq</p><p>qv</p>'), 'zq\nqv')).toEqual([]);
    expect(findInText(docOf('<p>zq<br>qv</p>'), 'zq\nqv')).toEqual([]);
    expect(findInText(doc, '\n')).toEqual([]);
  });

  it('FT-Q-3 a non-string query finds nothing', () => {
    [undefined, 3, null].forEach((bad) => {
      expect(findInText(doc, bad as unknown as string)).toEqual([]);
    });
  });

  it('FT-Q-4 an absent query, or one longer than the text, finds nothing', () => {
    expect(findInText(doc, 'vv')).toEqual([]);
    expect(findInText(doc, 'zq qv zq qv')).toEqual([]);
  });
});

describe('findInText positions and order', () => {
  it('FT-P-1 reports exact document positions', () => {
    const matches = find(docOf('<p>zq qv</p>'), 'qv', 'qv');
    expect(matches).toEqual([{ from: 4, to: 6 }]);
  });

  it('FT-P-2 matches across paragraphs come back in document order', () => {
    const doc = docOf('<p>zq qv zq</p><p>qv</p><p>zq zq</p>');
    const matches = find(doc, 'zq', 'zq');
    expect(matches).toHaveLength(4);
    const froms = matches.map((m) => m.from);
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
    expect(new Set(froms).size).toBe(4);
  });

  it('FT-P-3 matches do not overlap', () => {
    const doc = docOf('<p>zzzz</p>');
    expect(find(doc, 'zz', 'zz')).toEqual([
      { from: 1, to: 3 },
      { from: 3, to: 5 },
    ]);
    expect(find(doc, 'zzz', 'zzz')).toHaveLength(1);
  });

  it('FT-P-4 empty paragraphs between matches do not shift positions', () => {
    const doc = docOf('<p>zq</p><p></p><p>zq</p>');
    const matches = find(doc, 'zq', 'zq');
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ from: 1, to: 3 });
  });
});

describe('findInText case', () => {
  it('FT-C-1 matches ignoring case and returns the document case', () => {
    expect(find(docOf('<p>zq</p>'), 'ZQ', 'zq')).toHaveLength(1);
    expect(find(docOf('<p>ZQ</p>'), 'zq', 'ZQ')).toHaveLength(1);
    expect(find(docOf('<p>Zq</p>'), 'zq', 'Zq')).toHaveLength(1);
    const mixed = docOf('<p>ZQ and Zq</p>');
    const matches = findInText(mixed, 'zq');
    expect(matches.map((m) => mixed.textBetween(m.from, m.to))).toEqual([
      'ZQ',
      'Zq',
    ]);
  });

  it('FT-C-2 a character whose lower case is longer is compared as itself', () => {
    expect(findInText(docOf('<p>İ</p>'), 'i')).toEqual([]);
    const doc = docOf('<p>İzq</p>');
    expect(find(doc, 'zq', 'zq')).toEqual([{ from: 2, to: 4 }]);
  });

  it('FT-C-3 accented letters fold', () => {
    expect(find(docOf('<p>é</p>'), 'É', 'é')).toHaveLength(1);
  });
});

describe('findInText structure', () => {
  it('FT-S-1 a match runs across marks', () => {
    const doc = docOf('<p>z<strong>q</strong><em>v</em></p>');
    expect(find(doc, 'zqv', 'zqv')).toHaveLength(1);
  });

  it('FT-S-2 no match across a hard break', () => {
    const doc = docOf('<p>zq<br>qv</p>');
    expect(findInText(doc, 'zqqv')).toEqual([]);
    expect(find(doc, 'qv', 'qv')).toHaveLength(1);
  });

  it('FT-S-3 no match across paragraphs', () => {
    expect(findInText(docOf('<p>zq</p><p>qv</p>'), 'zqqv')).toEqual([]);
  });

  it('FT-S-4 whitespace is literal', () => {
    expect(find(docOf('<p>zq\tqv</p>'), 'q\tq', 'q\tq')).toHaveLength(1);
    const spaced = docOf('<p>zq  qv</p>');
    expect(find(spaced, 'q  q', 'q  q')).toHaveLength(1);
    expect(findInText(spaced, 'q q')).toEqual([]);
  });
});

describe('findInText non-ASCII', () => {
  it('FT-U-1 emoji do not disturb positions', () => {
    const doc = docOf('<p>\u{1F642}zq\u{1F642}</p>');
    expect(find(doc, 'zq', 'zq')).toEqual([{ from: 3, to: 5 }]);
    expect(find(doc, '\u{1F642}', '\u{1F642}')).toHaveLength(2);
  });

  it('FT-U-2 a match after many emoji in an earlier paragraph is positioned correctly', () => {
    const emoji = '\u{1F642}'.repeat(50);
    const doc = docOf(`<p>${emoji}</p><p>zq</p>`);
    const matches = find(doc, 'zq', 'zq');
    expect(matches).toHaveLength(1);
    // First paragraph: 2 boundary tokens + 100 UTF-16 units; second text starts after its open token.
    expect(matches[0]).toEqual({ from: 100 + 2 + 1, to: 100 + 2 + 3 });
  });
});
