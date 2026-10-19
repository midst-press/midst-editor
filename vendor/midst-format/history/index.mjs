// src/history.ts
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
export {
  compareStrings,
  reconstruct,
  reconstructArray,
  reconstructHTML,
  step
};
