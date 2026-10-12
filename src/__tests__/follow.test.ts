import {
  ease,
  glideMs,
  glideTo,
  gliding,
  MIN_GLIDE_VIEWPORT,
  PEAK_VIEWPORTS_PER_S,
} from '../renderer/components/Replay/follow';

const FRAME_MS = 1000 / 60;

/** The largest scroll change between consecutive 60Hz frames of one glide. */
function largestFrameStep(distance: number, viewport: number): number {
  const ms = glideMs(distance, viewport);
  let worst = 0;
  let prev = 0;
  for (let now = FRAME_MS; now < ms + FRAME_MS; now += FRAME_MS) {
    const at = distance * ease(Math.min(1, now / ms));
    worst = Math.max(worst, at - prev);
    prev = at;
  }
  return worst;
}

describe('glideMs', () => {
  // The website's player (a 439px view) shares this helper with the editor (568px), so the bound is
  // stated per viewport, not in pixels.
  const viewports = [300, 440, 568, 900];

  it.each(viewports)(
    'never moves more than 1/12 of a %ipx view in one 60Hz frame',
    (viewport) => {
      [10, 100, viewport, 5 * viewport, 50 * viewport].forEach((distance) => {
        expect(largestFrameStep(distance, viewport)).toBeLessThanOrEqual(
          viewport / (60 / PEAK_VIEWPORTS_PER_S) + 1e-9
        );
      });
    }
  );

  it('takes longer for the same distance in a shorter view', () => {
    expect(glideMs(2000, 440)).toBeGreaterThan(glideMs(2000, 568));
  });

  it('never glides for less than 250ms', () => {
    expect(glideMs(1, 568)).toBe(250);
  });
});

describe('glideTo', () => {
  // Playback waits while gliding() is true, so a glide that never ends stalls the timelapse.
  it.each([0, MIN_GLIDE_VIEWPORT - 1])(
    'moves a %ipx-tall scroller at once rather than gliding',
    (clientHeight) => {
      const el = { clientHeight, scrollTop: 0 } as HTMLElement;
      const glide = glideTo(el, 1000, null);
      expect(gliding(glide)).toBe(false);
      expect(el.scrollTop).toBe(1000);
    }
  );
});
