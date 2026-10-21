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

// src/extensions.ts
var extensions_exports = {};
__export(extensions_exports, {
  default: () => extensions_default
});
module.exports = __toCommonJS(extensions_exports);
var import_extension_hard_break = __toESM(require("@tiptap/extension-hard-break"));
var import_starter_kit = __toESM(require("@tiptap/starter-kit"));
var poemExtensions = [
  import_starter_kit.default.configure({
    bulletList: false,
    orderedList: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    hardBreak: false,
    strike: false,
    // TipTap 3's StarterKit adds these four (#102). A poem has no links, no underline and no lists, and TrailingNode
    // would append a paragraph to a document that ends otherwise, a change the writer never made. Off, so the schema
    // and the documents are TipTap 2's.
    link: false,
    underline: false,
    listKeymap: false,
    trailingNode: false
  }),
  // TipTap 3 marks the hard break as ProseMirror's linebreakReplacement, so a newline in a parsed text becomes a line
  // break. An old Midst frame's newline is a space, as the old player drew it and TipTap 2 parsed it; a break would add
  // a node and move every later history pos (#102). Same node, without the flag.
  import_extension_hard_break.default.extend({ linebreakReplacement: false })
];
var extensions_default = poemExtensions;
