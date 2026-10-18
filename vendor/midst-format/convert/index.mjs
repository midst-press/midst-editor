// src/convert.ts
import { generateJSON, generateHTML } from "@tiptap/html";
import { compareStrings } from "../history/index.mjs";
import poemExtensions from "../extensions/index.mjs";
var CURRENT_VERSION = "1";
var CURRENT_VERSION_LIST = ["1", "v0.0.1"];
var VERSION_HEADER = /^\uFEFF?midstVersion: (\S+?)\r?$/;
var getFileVersion = (data) => {
  if (typeof data !== "string") return "";
  const m = VERSION_HEADER.exec(data.split("\n", 1)[0]);
  return m ? m[1] : "";
};
var stripVersionInfo = (data) => {
  return data.split("\n")[1];
};
var includeVersionInfo = (data) => {
  return `midstVersion: ${CURRENT_VERSION}
${data}`;
};
var fileVersionMatchesCurrent = (data) => {
  const firstVersion = getFileVersion(data);
  return CURRENT_VERSION_LIST.includes(firstVersion);
};
var getTextLengthFromJSONContent = (doc) => {
  var _a;
  if (doc.type === "text") {
    return ((_a = doc.text) == null ? void 0 : _a.length) || 0;
  }
  if (doc.type === "hardBreak") {
    return 2;
  }
  if (doc.type === "paragraph" || doc.type === "doc") {
    const contents = doc.content || [];
    const lengths = contents.map((item) => {
      return getTextLengthFromJSONContent(item);
    });
    const amount = lengths.reduce((partialSum, a) => partialSum + a, 1);
    return amount;
  }
  return 0;
};
var TRAILING_BREAK = /<br\s*\/?>((?:\s*<\/(?:em|strong|i|b|u|span|s|strike|a)>)*\s*<\/p>)/gi;
var dropTrailingBreaks = (html) => html.replace(TRAILING_BREAK, "$1");
var ZERO_WIDTH_CHARS = "\\uFEFF\\u200B\\u200C\\u200D\\u2060";
var ZERO_WIDTH_ENTITY_CODES = [65279, 8203, 8204, 8205, 8288];
var ZERO_WIDTH_ENTITY = ZERO_WIDTH_ENTITY_CODES.map(
  (c) => `&#(?:x0*${c.toString(16)}|0*${c});`
).join("|");
var ZERO_WIDTH_ONLY_ELEMENT = new RegExp(
  `<(span|em|strong|i|b|u|s|strike|a)\\b[^>]*>(?:[${ZERO_WIDTH_CHARS}]|${ZERO_WIDTH_ENTITY})+</\\1>`,
  "gi"
);
var dropZeroWidthOnlyElements = (html) => {
  let current = html;
  let next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, "");
  while (next !== current) {
    current = next;
    next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, "");
  }
  return current;
};
var metaFromOldMidst = (old = {}) => {
  const meta = {};
  if ("editorFontFamily" in old) meta.fontFamily = old.editorFontFamily;
  if ("editorFontSize" in old) meta.fontSize = old.editorFontSize;
  if (Array.isArray(old.editorDraftMarkers))
    meta.draftMarkers = old.editorDraftMarkers.map(
      ({ timelineIndex, ...rest }) => ({
        index: timelineIndex,
        ...rest
      })
    );
  if ("editorHighestEverDraftNumber" in old)
    meta.highestDraftNumber = old.editorHighestEverDraftNumber;
  if ("editorTitle" in old) meta.title = old.editorTitle;
  return meta;
};
var withoutAuthor = (meta) => {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta))
    return meta;
  const { author, ...rest } = meta;
  return rest;
};
var serializeDocument = (text, history, meta) => JSON.stringify({
  text,
  history: JSON.parse(history),
  ...meta ? { meta: withoutAuthor(JSON.parse(meta)) } : {}
});
var convertMidstFile = (oldMidst) => {
  const oldMidstJSON = JSON.parse(oldMidst);
  const frames = oldMidstJSON.editorTimelineFrames;
  const newFrames = frames.map((el) => {
    const jsonContentAtFrame = generateJSON(
      dropTrailingBreaks(dropZeroWidthOnlyElements(el.content)),
      poemExtensions,
      {
        preserveWhitespace: true
      }
    );
    const htmlContentAtFrame = generateHTML(jsonContentAtFrame, poemExtensions);
    const truncatedJsonContentAtFrame = {
      ...jsonContentAtFrame,
      content: jsonContentAtFrame.content.slice(0, Number(el.lineNumber) + 1)
    };
    const position = getTextLengthFromJSONContent(truncatedJsonContentAtFrame);
    return {
      content: htmlContentAtFrame,
      pos: position,
      t: new Date(el.timestamp)
    };
  });
  const history = newFrames.map((el, ind) => {
    if (ind === 0) {
      return compareStrings("", el.content, el.pos, el.t);
    }
    return compareStrings(newFrames[ind - 1].content, el.content, el.pos, el.t);
  });
  const text = newFrames[newFrames.length - 1].content;
  const fullContents = JSON.stringify({
    text,
    history,
    meta: metaFromOldMidst(oldMidstJSON.meta)
  });
  return fullContents;
};
export {
  ZERO_WIDTH_CHARS,
  convertMidstFile,
  dropTrailingBreaks,
  dropZeroWidthOnlyElements,
  fileVersionMatchesCurrent,
  getFileVersion,
  includeVersionInfo,
  metaFromOldMidst,
  serializeDocument,
  stripVersionInfo
};
