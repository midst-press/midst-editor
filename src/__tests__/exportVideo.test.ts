import {
  VIDEO_FPS,
  frameCount,
  glideStep,
  stepAt,
} from '../renderer/components/ExportVideo/timeline';

// File > Export as Video… (#506): the clock that decides what each frame shows.

describe('stepAt', () => {
  it('follows the poet’s pace, not the video’s frame rate', () => {
    // 60 ms a step (the default pace) sampled at 30 fps: frame 0 is step 0, frame 2 (66.7 ms) is step 1.
    expect(stepAt(0, 60, 100)).toBe(0);
    expect(stepAt(1, 60, 100)).toBe(0);
    expect(stepAt(2, 60, 100)).toBe(1);
    // A slow pace holds a step for several frames: 1 step a second is 30 frames a step.
    expect(stepAt(29, 1000, 100)).toBe(0);
    expect(stepAt(30, 1000, 100)).toBe(1);
  });

  it('never passes the last step', () => {
    expect(stepAt(10_000, 60, 5)).toBe(5);
  });

  it('a fast pace skips steps rather than slowing down', () => {
    // 60 fps (16.7 ms a step) at 30 fps: every other step is shown.
    expect(stepAt(1, 1000 / 60, 100)).toBe(2);
  });
});

describe('frameCount', () => {
  it('reaches the last step, then holds it for three seconds', () => {
    const maxStep = 1521;
    const frames = frameCount(maxStep, 60);
    const holdFrames = 3 * VIDEO_FPS;
    expect(stepAt(frames - holdFrames - 1, 60, maxStep)).toBe(maxStep);
    // ...and not long before: the step just before the last is still on screen a few frames earlier.
    expect(stepAt(frames - holdFrames - 4, 60, maxStep)).toBe(maxStep - 1);
  });

  it('a one-frame history is the hold and one step', () => {
    expect(frameCount(0, 60)).toBe(2 + 3 * VIDEO_FPS);
  });
});

describe('glideStep', () => {
  // Peak 5 viewports a second over a 1000 px viewport, 30 fps: at most 166.7 px a frame.
  it('arrives exactly when the target is within one frame', () => {
    expect(glideStep(0, 100, 1000, 5)).toBe(100);
    expect(glideStep(500, 400, 1000, 5)).toBe(400);
  });

  it('never moves faster than the peak, in either direction', () => {
    expect(glideStep(0, 1000, 1000, 5)).toBeCloseTo(1000 / 6);
    expect(glideStep(1000, 0, 1000, 5)).toBeCloseTo(1000 - 1000 / 6);
  });

  it('stays put at the target', () => {
    expect(glideStep(300, 300, 1000, 5)).toBe(300);
  });
});
