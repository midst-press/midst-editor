import { useState } from 'react';
import { FRAME_MS } from './usePlayback';

// The two pace settings of the Timeline (Annelyse, GitHub #49; editor #427), so she can tune the frame
// rate and the scroll speed separately. Each is remembered in the store as a string, as the other replay
// settings are. Unset, or a value outside its range, gives today's pace, so nothing moves until she moves it.
export interface PaceSetting {
  key: 'replay-fps' | 'replay-scroll-speed';
  min: number;
  max: number;
  step: number;
  initial: number;
}

// Frames per second: the website's range (midst-web SpeedControl), starting at the app's own 60ms frame.
export const FPS: PaceSetting = {
  key: 'replay-fps',
  min: 1,
  max: 60,
  step: 0.1,
  initial: 1000 / FRAME_MS,
};

// Peak scroll speed in viewports per second, fine-grained, starting at midst-format's PEAK_VIEWPORTS_PER_S.
export const SCROLL_SPEED: PaceSetting = {
  key: 'replay-scroll-speed',
  min: 1,
  max: 20,
  step: 0.1,
  initial: 5,
};

export const paceFromStore = (
  setting: PaceSetting,
  stored: unknown
): number => {
  const n = typeof stored === 'string' && stored !== '' ? Number(stored) : NaN;
  return Number.isFinite(n) && n >= setting.min && n <= setting.max
    ? n
    : setting.initial;
};

export default function usePace(setting: PaceSetting) {
  const [value, setValue] = useState(() =>
    paceFromStore(setting, window.electron.store.get(setting.key))
  );
  const set = (next: number) => {
    if (!Number.isFinite(next) || next < setting.min || next > setting.max)
      return;
    window.electron.store.set(setting.key, String(next));
    setValue(next);
  };
  return { value, set };
}
