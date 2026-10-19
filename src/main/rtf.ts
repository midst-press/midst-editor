import { generateJSON } from '@tiptap/html';
import { JSONContent } from '@tiptap/core';
import poemExtensions from '@midst-press/midst-format/extensions';
import { i18n } from '../shared/i18n';

// A poem's text, as it is now, written as a Rich Text Format file (GitHub #26).
//
// The poem is read with the same schema and whitespace rule as the editor, so what is exported is
// what the poet sees: paragraphs, line breaks, bold and italic. Each of those has an RTF form. Anything
// else in the document is refused with its name rather than left out, so a later change to the schema
// cannot quietly produce a file that is missing part of the poem.

export type RtfResult =
  | { ok: true; rtf: string }
  | { ok: false; reason: string };

// The editor shows poems in the system font, which RTF cannot name. Helvetica, or Arial where there is
// no Helvetica, is the nearest that every reader has.
const HEADER =
  '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl{\\f0\\fswiss Helvetica{\\*\\falt Arial};}}\\f0\\fs24\n';

// Text as RTF. Nothing is dropped: the three characters RTF reserves are escaped, a tab is \tab, a line
// ending (\r\n, \r or \n) is \line, any other control character is its \'hh, and every character outside
// ASCII is \uN? with N the signed 16-bit code unit, so a character beyond the BMP is its two surrogates.
// The ? is what a reader without Unicode shows (\uc1: one fallback character per \u).
export const rtfText = (text: string): string => {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
    else if (ch === '\t') out += '\\tab ';
    else if (ch === '\r' && text[i + 1] === '\n') out += '';
    else if (ch === '\r' || ch === '\n') out += '\\line ';
    else if (code < 0x20 || code === 0x7f)
      out += `\\'${code.toString(16).padStart(2, '0')}`;
    else if (code < 0x80) out += ch;
    else out += `\\u${code > 0x7fff ? code - 0x10000 : code}?`;
  }
  return out;
};

const MARKS: Record<string, string> = { bold: '\\b', italic: '\\i' };

type Walk = { ok: true; rtf: string } | { ok: false; reason: string };

// Each item's RTF joined, or the first item's refusal.
// eslint-disable-next-line no-unused-vars -- the name in this function type says what the argument is
const joinAll = <T>(items: T[], each: (item: T) => Walk): Walk => {
  const done = items.map(each);
  const refused = done.find((d) => !d.ok);
  if (refused) return refused;
  return { ok: true, rtf: done.map((d) => (d.ok ? d.rtf : '')).join('') };
};

const inline = (node: JSONContent): Walk => {
  if (node.type === 'hardBreak') return { ok: true, rtf: '\\line ' };
  if (node.type !== 'text') {
    return {
      ok: false,
      reason: i18n._('rtf.refused.insideLine', { type: node.type }),
    };
  }
  const words = joinAll(node.marks ?? [], (mark) =>
    MARKS[mark.type]
      ? { ok: true, rtf: MARKS[mark.type] }
      : {
          ok: false,
          reason: i18n._('rtf.refused.formatting', { type: mark.type }),
        }
  );
  if (!words.ok) return words;
  const text = rtfText(node.text ?? '');
  return { ok: true, rtf: words.rtf ? `{${words.rtf} ${text}}` : text };
};

const paragraph = (node: JSONContent): Walk => {
  if (node.type !== 'paragraph') {
    return {
      ok: false,
      reason: i18n._('rtf.refused.node', { type: node.type }),
    };
  }
  const line = joinAll(node.content ?? [], inline);
  return line.ok ? { ok: true, rtf: `${line.rtf}\\par\n` } : line;
};

const hasText = (node: JSONContent): boolean =>
  (node.type === 'text' && !!node.text) || (node.content ?? []).some(hasText);

// `doc` is a poem as ProseMirror JSON.
export const docToRtf = (doc: JSONContent): RtfResult => {
  if (!hasText(doc)) {
    return {
      ok: false,
      reason: i18n._('rtf.empty'),
    };
  }
  const body = joinAll(doc.content ?? [], paragraph);
  if (!body.ok) {
    return {
      ok: false,
      reason: i18n._('rtf.cannotWrite', { what: body.reason }),
    };
  }
  return { ok: true, rtf: `${HEADER}${body.rtf}}\n` };
};

// `html` is the poem as the editor stores it (the store's `poem`), read as the editor reads it.
export const poemToRtf = (html: string): RtfResult =>
  docToRtf(generateJSON(html, poemExtensions, { preserveWhitespace: true }));
