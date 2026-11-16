// The export's clock (#506): which history step each video frame shows, how many frames, and the scroll.

export const VIDEO_FPS = 30;
export const FRAME_US = 1_000_000 / VIDEO_FPS;
// The last frame is held this long, so the finished poem can be read.
const HOLD_S = 3;

/** The history step frame n shows: the poet's pace decides it, the video's 30 fps only samples it. */
export const stepAt = (n: number, frameMs: number, maxStep: number) =>
  Math.min(Math.floor((n * 1000) / VIDEO_FPS / frameMs), maxStep);

/** How many frames: every step at the poet's pace, then the hold. */
export const frameCount = (maxStep: number, frameMs: number) =>
  Math.ceil(((maxStep + 1) * frameMs * VIDEO_FPS) / 1000) + HOLD_S * VIDEO_FPS;

/** One frame's scroll toward the target at the poet's peak speed: never past it, never faster than the peak. */
export const glideStep = (
  from: number,
  to: number,
  viewport: number,
  peak: number
) => {
  const max = (peak * viewport) / VIDEO_FPS;
  const d = to - from;
  return Math.abs(d) <= max ? to : from + Math.sign(d) * max;
};
