import { useState } from 'react';

// Whether the timeline's timestamp is always shown, or only while pointing at the dot (GitHub #94). Remembered
// in the store as a string, as the other settings are: off by default, so only 'true' turns it on.
export const SHOW_TIMESTAMP_KEY = 'replay-show-timestamp';

export default function useShowTimestamp() {
  const [on, setOn] = useState(
    () => window.electron.store.get(SHOW_TIMESTAMP_KEY) === 'true'
  );
  const set = (next: boolean) => {
    window.electron.store.set(SHOW_TIMESTAMP_KEY, String(next));
    setOn(next);
  };
  return { on, set };
}
