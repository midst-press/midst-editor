var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/history.ts
var history_exports = {};
__export(history_exports, {
  compareStrings: () => compareStrings,
  reconstruct: () => reconstruct,
  reconstructArray: () => reconstructArray,
  reconstructHTML: () => reconstructHTML,
  step: () => step
});
module.exports = __toCommonJS(history_exports);
var step = (initial, change) => {
  const endingIndex = initial.length - change.end;
  return initial.slice(0, change.front) + change.inserted + initial.slice(endingIndex);
};
var compareStrings = (str, next, pos, t = /* @__PURE__ */ new Date()) => {
  let inserted = "";
  let front = 0;
  let end = 0;
  if (str === next) return { inserted, front: str.length, end, t, pos };
  while (str[front] === next[front] && front < str.length) {
    front += 1;
  }
  const choppedStr = str.slice(front);
  const choppedNext = next.slice(front);
  while (choppedStr[choppedStr.length - end - 1] === choppedNext[choppedNext.length - end - 1] && end < choppedStr.length) {
    end += 1;
  }
  inserted = next.slice(front, next.length - end);
  return { inserted, front, end, t, pos };
};
var reconstruct = (initial, changes, index) => {
  if (changes) {
    return changes.slice(0, index + 1).reduce((acc, val) => step(acc, val), initial);
  }
  return "";
};
var reconstructArray = (initial, changes, index) => {
  if (!changes.length) return [];
  const reconstructed = reconstruct(initial, changes, index);
  const insertPosition = changes[index].front + changes[index].inserted.length;
  const insertRowNum = reconstructed.slice(0, insertPosition).split("\n").length - 1;
  return reconstructed.split("\n").map((row, j) => ({
    text: row,
    isInsertRow: j === insertRowNum,
    key: j
  }));
};
var reconstructHTML = (initial, changes, index) => {
  if (!changes.length) return "";
  const reconstructed = reconstruct(initial, changes, index);
  return reconstructed;
};
