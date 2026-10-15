import { useState } from 'react';

// Whether replay scrolls to follow the writing (GitHub #23). Remembered in the store as a string, as the other
// settings are: only 'false' turns it off, so a new profile, or a value nobody expected, follows the writing.
export const AUTOSCROLL_KEY = 'replay-autoscroll';

export default function useAutoscroll() {
  const [on, setOn] = useState(
    () => window.electron.store.get(AUTOSCROLL_KEY) !== 'false'
  );
  const toggle = () => {
    const next = !on;
    window.electron.store.set(AUTOSCROLL_KEY, String(next));
    setOn(next);
    return next;
  };
  return { on, toggle };
}
