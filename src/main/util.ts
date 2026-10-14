/* eslint import/prefer-default-export: off */
import { BrowserWindow } from 'electron';
import path from 'path';
import { compareStrings } from 'renderer/tracking/utils';
import { URL } from 'url';
import { generateJSON, generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import { JSONContent } from '@tiptap/core';
import store from './store';

const extensions = [
  StarterKit.configure({
    bulletList: false,
    orderedList: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    strike: false,
  }),
];

interface OldMidstTimelineFrame {
  content: string;
  lineNumber: string;
  timestamp: number;
}

interface NewFrames {
  content: string;
  pos: number;
  t: Date;
}

export function resolveHtmlPath(htmlFileName: string) {
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT || 1212;
    const url = new URL(`http://localhost:${port}`);
    url.pathname = htmlFileName;
    return url.href;
  }
  return `file://${path.resolve(__dirname, '../renderer/', htmlFileName)}`;
}

const CURRENT_VERSION = '1';
const CURRENT_VERSION_LIST = ['1', 'v0.0.1'];

export const getFileVersion = (data: string) => {
  try {
    const rows = data.split('\n');
    return rows[0].split(': ')[1];
  } catch {
    return '';
  }
};

export const stripVersionInfo = (data: string) => {
  return data.split('\n')[1];
};
export const includeVersionInfo = (data: string) => {
  return `midstVersion: ${CURRENT_VERSION}\n${data}`;
};

export const fileVersionMatchesCurrent = (data: string) => {
  const firstVersion = getFileVersion(data);
  return CURRENT_VERSION_LIST.includes(firstVersion);
};

const getTextLengthFromJSONContent = (doc: JSONContent): number => {
  // count all the characters (hard breaks are two)
  // each is a line of text or hardbreak
  // then that text count is actually the position
  if (doc.type === 'text') {
    return doc.text?.length || 0;
  }
  if (doc.type === 'hardBreak') {
    return 2;
  }
  if (doc.type === 'paragraph' || doc.type === 'doc') {
    const contents = doc.content || [];
    const lengths: number[] = contents.map((item) => {
      return getTextLengthFromJSONContent(item);
    });
    const amount = lengths.reduce((partialSum, a) => partialSum + a, 1);
    return amount;
  }
  return 0;
};

// A browser never draws a <br> that is the last thing in its block: <p><br></p> is ONE empty line,
// <p>a<br></p> is one line. ProseMirror draws the same <br> as a hard break plus a trailing line, so
// every blank line of an old poem doubled. Drop exactly that one <br> (closing inline tags may follow
// it); a second <br> before it is a real line and stays. Paragraphs only: an emptied <div> would lose
// its line in the editor (measured by midst-format's render_lines, html-shape--div-as-line).
const TRAILING_BREAK =
  /<br\s*\/?>((?:\s*<\/(?:em|strong|i|b|u|span|s|strike|a)>)*\s*<\/p>)/gi;
export const dropTrailingBreaks = (html: string) =>
  html.replace(TRAILING_BREAK, '$1');

/**
 * Format B's per-poem presentation, as format C's `meta` (midst-format docs/META.md). Each field
 * is copied unchanged; a field B does not have is left out, so the reader's default applies.
 */
export const metaFromOldMidst = (old: Record<string, unknown> = {}) => {
  const meta: Record<string, unknown> = {};
  if ('editorFontFamily' in old) meta.fontFamily = old.editorFontFamily;
  if ('editorFontSize' in old) meta.fontSize = old.editorFontSize;
  if (Array.isArray(old.editorDraftMarkers))
    meta.draftMarkers = old.editorDraftMarkers.map(
      ({ timelineIndex, ...rest }: Record<string, unknown>) => ({
        index: timelineIndex,
        ...rest,
      })
    );
  if ('editorHighestEverDraftNumber' in old)
    meta.highestDraftNumber = old.editorHighestEverDraftNumber;
  if ('editorTitle' in old) meta.title = old.editorTitle;
  if ('editorAuthor' in old) meta.author = old.editorAuthor;
  return meta;
};

/**
 * The file body the editor saves. `meta` is the stored JSON string ('' when the document has
 * none) and is written back unchanged, unknown keys included, so a save never loses it.
 */
export const serializeDocument = (
  text: string,
  history: string,
  meta: string
) =>
  JSON.stringify({
    text,
    history: JSON.parse(history),
    ...(meta ? { meta: JSON.parse(meta) } : {}),
  });

export const convertMidstFile = (oldMidst: string) => {
  const oldMidstJSON = JSON.parse(oldMidst);
  const frames = oldMidstJSON.editorTimelineFrames;

  const newFrames = frames.map((el: OldMidstTimelineFrame) => {
    // Parse as the editor does (Editor and Replay use preserveWhitespace: true).
    // The default collapses tabs and drops a line-leading tab; poets use tabs for spacing.
    const jsonContentAtFrame = generateJSON(
      dropTrailingBreaks(el.content),
      extensions,
      {
        preserveWhitespace: true,
      }
    );
    const htmlContentAtFrame = generateHTML(jsonContentAtFrame, extensions);
    // get the slice of the content before the line number
    const truncatedJsonContentAtFrame = {
      ...jsonContentAtFrame,
      content: jsonContentAtFrame.content.slice(0, Number(el.lineNumber) + 1),
    };
    const position = getTextLengthFromJSONContent(truncatedJsonContentAtFrame);

    return {
      content: htmlContentAtFrame,
      pos: position,
      t: new Date(el.timestamp),
    };
  });
  const history = newFrames.map((el: NewFrames, ind: number) => {
    if (ind === 0) {
      return compareStrings('', el.content, el.pos, el.t);
    }
    return compareStrings(newFrames[ind - 1].content, el.content, el.pos, el.t);
  });
  const text = newFrames[newFrames.length - 1].content;

  const fullContents = JSON.stringify({
    text,
    history,
    meta: metaFromOldMidst(oldMidstJSON.meta),
  });
  return fullContents;
};

export const loadDataIntoWorkspace = (
  filename: string,
  data: string,
  mainWindow: BrowserWindow,
  darwin: boolean
) => {
  const { text, history, meta } = JSON.parse(stripVersionInfo(data));
  store.set('poem', text);
  store.set('history', JSON.stringify(history));
  // Always set, so a poem without meta never inherits the previous poem's.
  store.set('meta', meta === undefined ? '' : JSON.stringify(meta));
  store.set('filename', filename);
  store.set('baseFilename', path.basename(filename));
  mainWindow.webContents.send(
    'open-file',
    text,
    history,
    path.basename(filename)
  );
  if (darwin) {
    mainWindow.setDocumentEdited(false);
    mainWindow.setRepresentedFilename(path.basename(filename));
  }
  store.set('edited', JSON.stringify(false));
};
