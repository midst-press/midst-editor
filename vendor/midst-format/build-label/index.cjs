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

// src/buildLabel.ts
var buildLabel_exports = {};
__export(buildLabel_exports, {
  buildLabel: () => buildLabel,
  isPreRelease: () => isPreRelease,
  utcMinute: () => utcMinute
});
module.exports = __toCommonJS(buildLabel_exports);
var TAG = /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
var isPreRelease = (tag) => {
  const parts = TAG.exec(tag);
  return !parts || parts[1] === "0" || parts[4] !== void 0;
};
var two = (n) => String(n).padStart(2, "0");
var utcMinute = (iso) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return void 0;
  const day = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(
    at.getUTCDate()
  )}`;
  return `${day} ${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC`;
};
var buildLabel = (identity) => {
  var _a, _b, _c, _d;
  const tag = ((_a = identity.tag) != null ? _a : "").trim();
  const commit = ((_b = identity.commit) != null ? _b : "").trim();
  const committedAt = ((_c = identity.committedAt) != null ? _c : "").trim();
  if (!tag && !commit && !committedAt) return "Development build";
  const parts = [tag ? `Version ${tag}` : "Untagged build"];
  if (commit) parts.push(`commit ${commit}`);
  if (committedAt)
    parts.push(`committed ${(_d = utcMinute(committedAt)) != null ? _d : committedAt}`);
  return parts.join(", ");
};
