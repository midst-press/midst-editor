// src/convert.ts
import { generateJSON, generateHTML } from "@tiptap/html";
import { getSchema } from "@tiptap/core";
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
var schema = getSchema(poemExtensions);
var endOfBlock = (doc, index) => {
  const blocks = index >= 0 ? Math.min(doc.childCount, index + 1) : 0;
  let size = 0;
  for (let i = 0; i < blocks; i += 1) size += doc.child(i).nodeSize;
  return blocks === 0 ? 0 : size - 1;
};
var frameJSON = (html) => generateJSON(dropTrailingBreaks(html), poemExtensions, {
  preserveWhitespace: true
});
var keptBlock = (source, lineNumber) => {
  const line = Number(lineNumber);
  if (!Number.isFinite(line) || line < 0) return -1;
  if (dropInvisibleParagraphs(source) === source) return Math.floor(line);
  const text = schema.nodeFromJSON(frameJSON(source)).textContent;
  let mark = "\uE000";
  while (source.includes(mark) || text.includes(mark)) mark += "\uE000";
  const marked = markInvisibleParagraphs(source, mark);
  const before = schema.nodeFromJSON(frameJSON(marked));
  const last = Math.min(before.childCount, Math.floor(line) + 1);
  let kept = 0;
  for (let i = 0; i < last; i += 1)
    if (before.child(i).textContent !== mark) kept += 1;
  return kept - 1;
};
var TRAILING_BREAK = /<br\s*\/?>((?:\s|<\/(?:em|strong|i|b|u|span|s|strike|a|font|sup|sub)>|<(?:em|strong|i|b|u|span|s|strike|a|font|sup|sub)\b(?![^>]*[\s;"'](?:white-space|display|min-height|height|margin|padding|border)[\w-]*\s*:)[^>]*>)*<\/p>)/gi;
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
var INLINE_TAGS = "em|strong|i|b|u|span|s|strike|a|font|sup|sub";
var NO_BOX_STYLE = `(?![^>]*[\\s;"'](?:white-space|display|min-height|height|margin|padding|border)[\\w-]*\\s*:)`;
var INVISIBLE_PARAGRAPH = new RegExp(
  `<p\\b${NO_BOX_STYLE}[^>]*>(?:[ \\n\\r\\f]|<(?:${INLINE_TAGS})\\b${NO_BOX_STYLE}[^>]*>|</(?:${INLINE_TAGS})>)*</p>`,
  "gi"
);
var replaceInvisibleParagraphs = (html, by) => {
  let current = html;
  let next = current.replace(INVISIBLE_PARAGRAPH, by);
  while (next !== current) {
    current = next;
    next = current.replace(INVISIBLE_PARAGRAPH, by);
  }
  return current;
};
var dropInvisibleParagraphs = (html) => replaceInvisibleParagraphs(html, "");
var markInvisibleParagraphs = (html, mark) => replaceInvisibleParagraphs(html, `<p>${mark}</p>`);
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
    const source = dropZeroWidthOnlyElements(el.content);
    const jsonContentAtFrame = frameJSON(dropInvisibleParagraphs(source));
    const htmlContentAtFrame = generateHTML(jsonContentAtFrame, poemExtensions);
    const doc = schema.nodeFromJSON(jsonContentAtFrame);
    const position = endOfBlock(doc, keptBlock(source, el.lineNumber));
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
  dropInvisibleParagraphs,
  dropTrailingBreaks,
  dropZeroWidthOnlyElements,
  fileVersionMatchesCurrent,
  getFileVersion,
  includeVersionInfo,
  metaFromOldMidst,
  serializeDocument,
  stripVersionInfo
};
