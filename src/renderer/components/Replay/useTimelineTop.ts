import { RefObject, useLayoutEffect, useState } from 'react';

// How far down the replay the timeline's bar starts, in px from the top of the layout, so the Settings panel's divider
// can stop just above it (GitHub #117, item 3). Measured from layout, not from the screen: the bar grows in with a
// scale transform, and a rectangle read during it would put the top too low. It follows the bar as the timeline
// moves for the names and as the window is resized. Null until measured, and where nothing can watch for changes.
export default function useTimelineTop(
  bar: RefObject<HTMLElement | null>,
  main: RefObject<HTMLElement | null>
): number | null {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (bar.current) setTop(bar.current.offsetTop);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(measure);
    if (main.current) watch.observe(main.current);
    window.addEventListener('resize', measure);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [bar, main]);
  return top;
}
