/** The nearest ancestor that actually scrolls vertically, or null. */
export declare function scrollParent(el: HTMLElement | null): HTMLElement | null;
/** Fraction of the view kept clear at the top and bottom: a point inside the band needs no scroll. */
export declare const MARGIN = 0.15;
/**
 * The scrollTop that centres a point, or null when the point is already comfortably in view.
 * `top`/`bottom` are the point's viewport coordinates; `box` is the scroller's client rect.
 */
export declare function targetScrollTop(point: {
    top: number;
    bottom: number;
}, box: {
    top: number;
    height: number;
}, scrollTop: number, scrollHeight: number): number | null;
/**
 * Peak glide speed, in viewports per second. Speed is set relative to the viewport, not in pixels,
 * so a short window (the website's player) is not scrolled harder than a tall one (the editor):
 * at 5 viewports/s a single 60Hz frame moves at most 1/12 of the view, and two frames landing in
 * one sample at most 1/6. On the editor's ~900px view this is about the earlier fixed 5 px/ms peak.
 */
export declare const PEAK_VIEWPORTS_PER_S = 5;
/**
 * Glide duration for `distance` px in a view `viewport` px tall. The ease below peaks at twice its
 * average speed, so the duration that keeps the peak at PEAK_VIEWPORTS_PER_S is
 * 2 * distance / (PEAK * viewport) seconds. Never shorter than 250ms, so a small move still reads
 * as a glide.
 *
 * No upper cap, and that is a trade: a gentle bound and a fixed cap cannot both hold for every
 * distance, and playback waits for the glide. So a long jump pauses the timelapse in proportion to
 * its length: at 5 viewports/s, 0.4s per view (5 views 2s, 20 views 8s, 50 views 20s). Measured
 * jumps in Annelyse's Autoscroll Test Poem stay under 2 views. Whether a very long jump should
 * instead jump most of the way and glide the rest is an open question for the editor
 * (clement-7074f29f, midst-editor#24).
 */
export declare function glideMs(distance: number, viewport: number): number;
export declare const ease: (t: number) => number;
export interface Glide {
    to: number;
    frame: number;
    done: boolean;
    el: HTMLElement;
}
/** True while a glide is still moving. If the page is hidden (Chromium does not run animation
 * frames for a hidden page), the glide is finished immediately: scroll to target and stop. */
export declare function gliding(g: Glide | null): boolean;
/**
 * Views shorter than this are not glided: a collapsed or hidden scroller reports a height near 0,
 * which would make glideMs enormous, and playback waits for every glide (clement-7074f29f, #24).
 */
export declare const MIN_GLIDE_VIEWPORT = 50;
/**
 * The most glide time one frame may advance: two 60Hz frames. At PEAK_VIEWPORTS_PER_S that is at
 * most 1/6 of the view per frame, however long the frame actually took (midst-web#11's runner
 * showed 150-226ms stalls, which moved a wall-clock glide a whole stall's worth in one frame).
 */
export declare const MAX_FRAME_MS: number;
/** Glide `el` to `to`. Returns the glide, so the caller can tell whether it is already heading there. */
export declare function glideTo(el: HTMLElement, to: number, current: Glide | null): Glide | null;
