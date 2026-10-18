var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/convert.ts
var convert_exports = {};
__export(convert_exports, {
  ZERO_WIDTH_CHARS: () => ZERO_WIDTH_CHARS,
  convertMidstFile: () => convertMidstFile,
  dropTrailingBreaks: () => dropTrailingBreaks,
  dropZeroWidthOnlyElements: () => dropZeroWidthOnlyElements,
  fileVersionMatchesCurrent: () => fileVersionMatchesCurrent,
  getFileVersion: () => getFileVersion,
  includeVersionInfo: () => includeVersionInfo,
  metaFromOldMidst: () => metaFromOldMidst,
  serializeDocument: () => serializeDocument,
  stripVersionInfo: () => stripVersionInfo
});
module.exports = __toCommonJS(convert_exports);
var import_html = require("@tiptap/html");
var import_history = require("../history/index.cjs");
var import_extensions = __toESM(require("../extensions/index.cjs"));
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
    const jsonContentAtFrame = (0, import_html.generateJSON)(
      dropTrailingBreaks(dropZeroWidthOnlyElements(el.content)),
      import_extensions.default,
      {
        preserveWhitespace: true
      }
    );
    const htmlContentAtFrame = (0, import_html.generateHTML)(jsonContentAtFrame, import_extensions.default);
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
      return (0, import_history.compareStrings)("", el.content, el.pos, el.t);
    }
    return (0, import_history.compareStrings)(newFrames[ind - 1].content, el.content, el.pos, el.t);
  });
  const text = newFrames[newFrames.length - 1].content;
  const fullContents = JSON.stringify({
    text,
    history,
    meta: metaFromOldMidst(oldMidstJSON.meta)
  });
  return fullContents;
};
