// src/follow.ts
function scrollParent(el) {
  let s = el;
  while (s) {
    if (s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))
      return s;
    s = s.parentElement;
  }
  return null;
}
var MARGIN = 0.15;
function targetScrollTop(point, box, scrollTop, scrollHeight) {
  const lo = box.top + box.height * MARGIN;
  const hi = box.top + box.height * (1 - MARGIN);
  if (point.top >= lo && point.bottom <= hi) return null;
  const centre = scrollTop + (point.top + point.bottom) / 2 - box.top - box.height / 2;
  return Math.max(0, Math.min(scrollHeight - box.height, Math.round(centre)));
}
var PEAK_VIEWPORTS_PER_S = 5;
function glideMs(distance, viewport) {
  const ms = 2 * distance * 1e3 / (PEAK_VIEWPORTS_PER_S * Math.max(1, viewport));
  return Math.max(250, ms);
}
var ease = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
function gliding(g) {
  if (!g || g.done) return false;
  if (document.hidden) {
    cancelAnimationFrame(g.frame);
    g.el.scrollTop = g.to;
    g.done = true;
    return false;
  }
  return true;
}
var MIN_GLIDE_VIEWPORT = 50;
var MAX_FRAME_MS = 2 * (1e3 / 60);
function glideTo(el, to, current) {
  if (current && !current.done && Math.abs(current.to - to) < 2) return current;
  if (current && !current.done) cancelAnimationFrame(current.frame);
  const from = el.scrollTop;
  const distance = Math.abs(to - from);
  if (distance < 2) return null;
  if (el.clientHeight < MIN_GLIDE_VIEWPORT) {
    el.scrollTop = to;
    return null;
  }
  const ms = glideMs(distance, el.clientHeight);
  let last = performance.now();
  let progress = 0;
  const glide = { to, frame: 0, done: false, el };
  const tick = (now) => {
    progress += Math.max(0, Math.min(now - last, MAX_FRAME_MS));
    last = now;
    const t = Math.min(1, progress / ms);
    el.scrollTop = from + (to - from) * ease(t);
    if (t < 1) glide.frame = requestAnimationFrame(tick);
    else glide.done = true;
  };
  glide.frame = requestAnimationFrame(tick);
  return glide;
}
export {
  MARGIN,
  MAX_FRAME_MS,
  MIN_GLIDE_VIEWPORT,
  PEAK_VIEWPORTS_PER_S,
  ease,
  glideMs,
  glideTo,
  gliding,
  scrollParent,
  targetScrollTop
};
