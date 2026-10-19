// src/buildLabel.ts
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
export {
  buildLabel,
  isPreRelease,
  utcMinute
};
