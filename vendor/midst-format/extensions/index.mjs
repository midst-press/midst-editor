// src/extensions.ts
import StarterKit from "@tiptap/starter-kit";
var poemExtensions = [
  StarterKit.configure({
    bulletList: false,
    orderedList: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    strike: false
  })
];
var extensions_default = poemExtensions;
export {
  extensions_default as default
};
