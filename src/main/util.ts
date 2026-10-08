/* eslint import/prefer-default-export: off */
import { BrowserWindow } from 'electron';
import path from 'path';
import { ChangeObj } from 'renderer/tracking/utils';
import { URL } from 'url';
import store from './store';
import { generateJSON, generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import { JSONContent } from '@tiptap/core';

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

const compareStrings = (
  str: string,
  next: string,
  t: Date,
  pos?: number
): ChangeObj => {
  // fix to use position
  let inserted = '';
  let front = 0;
  let end = 0;

  //   if (str === next) return { inserted, front, end, t };
  while (str[front] === next[front] && front < str.length) {
    front += 1;
  }

  // you could definitely do this just by shortening the while loop but okay
  const choppedStr = str.slice(front);
  const choppedNext = next.slice(front);
  while (
    choppedStr[choppedStr.length - end - 1] ===
      choppedNext[choppedNext.length - end - 1] &&
    end < choppedStr.length
  ) {
    end += 1;
  }

  inserted = next.slice(front, next.length - end);
  const returnFrame = { inserted, front, end, t, pos };
  return returnFrame;
};

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

export const convertMidstFile = (oldMidst: string) => {
  const oldMidstJSON = JSON.parse(oldMidst);
  const frames = oldMidstJSON.editorTimelineFrames;

  const newFrames = frames.map((el: OldMidstTimelineFrame, index: number) => {
    const jsonContentAtFrame = generateJSON(el.content, extensions);
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
      return compareStrings('', el.content, el.t, el.pos);
    }
    return compareStrings(newFrames[ind - 1].content, el.content, el.t, el.pos);
  });
  const text = newFrames[newFrames.length - 1].content;

  const fullContents = JSON.stringify({
    text,
    history,
  });
  return fullContents;
};

export const loadDataIntoWorkspace = (
  filename: string,
  data: string,
  mainWindow: BrowserWindow,
  darwin: boolean
) => {
  const { text, history } = JSON.parse(stripVersionInfo(data));
  store.set('poem', text);
  store.set('history', JSON.stringify(history));
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

export const getNewMidstFilename = (oldFilename: string) => {
  // this will overwrite a file without giving you a chance to prevent it
  // may be worth updating the logic to avoid that
  if (oldFilename.endsWith('.midst')) {
    return `${oldFilename.slice(0, -6)}-converted.midst`;
  }
  return `${oldFilename}-converted.midst`;
};
