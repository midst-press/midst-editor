import { Node as ProseMirrorNode } from '@tiptap/pm/model';

// Finding text in the poem as it stands (GitHub #27). Earlier frames are not searched.
//
// A match is a range of ProseMirror document positions, so the editor can select it and scroll to it.
// Each paragraph is searched on its own: a match can run across bold or italic (which split a line into
// several text nodes) but never across a line break or from one paragraph into the next, since the poet
// sees those as separate lines.

export interface Match {
  from: number;
  to: number;
}

// Lower case, one character (code point) at a time, but only where that keeps its length: a few characters
// (for example the dotted capital I) lower-case to two units, which would shift every position after them.
const fold = (unit: string) => {
  const lower = unit.toLowerCase();
  return lower.length === unit.length ? lower : unit;
};
const foldAll = (text: string) => Array.from(text, fold).join('');

// What a line break contributes to a paragraph's text: a character no query can contain, so no match
// spans it. (A query is typed in a single-line field.)
const BREAK = '\n';

// The text of one paragraph, and the document position of each of its UTF-16 units.
function lineOf(block: ProseMirrorNode, start: number) {
  let text = '';
  const positions: number[] = [];
  block.forEach((child, offset) => {
    const at = start + offset;
    if (child.isText) {
      const value = child.text ?? '';
      for (let i = 0; i < value.length; i += 1) positions.push(at + i);
      text += value;
    } else {
      positions.push(at);
      text += BREAK;
    }
  });
  return { text, positions };
}

// Every place `query` occurs in `doc`, in document order, ignoring case. Matches do not overlap: after one
// is found the search carries on from its end. An empty query, or one that is only a line break, finds
// nothing.
export default function findInText(
  doc: ProseMirrorNode,
  query: string
): Match[] {
  if (typeof query !== 'string' || query.length === 0 || query.includes(BREAK))
    return [];
  const needle = foldAll(query);
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const { text, positions } = lineOf(node, pos + 1);
    const haystack = foldAll(text);
    let from = haystack.indexOf(needle);
    while (from !== -1) {
      const last = from + needle.length - 1;
      matches.push({ from: positions[from], to: positions[last] + 1 });
      from = haystack.indexOf(needle, from + needle.length);
    }
    return false;
  });
  return matches;
}
