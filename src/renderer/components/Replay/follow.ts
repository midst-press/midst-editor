// Replay follows the writing (midst-press/midst-web#32, midst-editor #20).
//
// Annelyse: "when the author jumps to a place that was off screen, the content should scroll gently to
// that new point rather than jump", so the reader keeps their place.
//
// The old code scrolled `domAtPos(pos).node` into view. For a caret inside text that node is a Text node,
// which has no scrollIntoView, so nothing moved; at a boundary the scroll was instant. And `pos` itself is
// unreliable in converted poems. So:
//   WHERE   the first position where the document changed, from the documents themselves (findDiffStart),
//           not the recorded pos.
//   WHEN    only when that point is outside the comfortable middle of the view; writing already on screen
//           does not move the page.
//   HOW     a glide whose duration grows with distance, centring the point. A new target replaces the
//           glide in flight; the same target does not restart it.
//   WAIT    playback does not advance while a glide is in flight (midst-press/midst-editor#22), so the
//           reader arrives before the writing moves on.

/** The nearest ancestor that actually scrolls vertically, or null. */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let s = el;
  while (s) {
    if (
      s.scrollHeight > s.clientHeight + 1 &&
      /(auto|scroll)/.test(getComputedStyle(s).overflowY)
    )
      return s;
    s = s.parentElement;
  }
  return null;
}

/** Fraction of the view kept clear at the top and bottom: a point inside the band needs no scroll. */
export const MARGIN = 0.15;

/**
 * The scrollTop that centres a point, or null when the point is already comfortably in view.
 * `top`/`bottom` are the point's viewport coordinates; `box` is the scroller's client rect.
 */
export function targetScrollTop(
  point: { top: number; bottom: number },
  box: { top: number; height: number },
  scrollTop: number,
  scrollHeight: number
): number | null {
  const lo = box.top + box.height * MARGIN;
  const hi = box.top + box.height * (1 - MARGIN);
  if (point.top >= lo && point.bottom <= hi) return null;
  const centre =
    scrollTop + (point.top + point.bottom) / 2 - box.top - box.height / 2;
  return Math.max(0, Math.min(scrollHeight - box.height, Math.round(centre)));
}

/** Glide duration: gentle for a short move, longer for a long one, but never slower than 1.5s. */
export function glideMs(distance: number): number {
  return Math.max(250, Math.min(1500, distance / 2.5));
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export interface Glide {
  to: number;
  frame: number;
  done: boolean;
}

/** True while a glide is still moving. */
export const gliding = (g: Glide | null) => !!g && !g.done;

/** Glide `el` to `to`. Returns the glide, so the caller can tell whether it is already heading there. */
export function glideTo(
  el: HTMLElement,
  to: number,
  current: Glide | null
): Glide | null {
  if (current && !current.done && Math.abs(current.to - to) < 2) return current;
  if (current && !current.done) cancelAnimationFrame(current.frame);
  const from = el.scrollTop;
  const distance = Math.abs(to - from);
  if (distance < 2) return null;
  const ms = glideMs(distance);
  const t0 = performance.now();
  const glide: Glide = { to, frame: 0, done: false };
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    el.scrollTop = from + (to - from) * ease(t);
    if (t < 1) glide.frame = requestAnimationFrame(tick);
    else glide.done = true;
  };
  glide.frame = requestAnimationFrame(tick);
  return glide;
}
