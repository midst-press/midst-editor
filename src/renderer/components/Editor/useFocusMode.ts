import { useCallback, useEffect, useState } from 'react';

// Focus Mode (GitHub #25): a minimalist writing view where every interface option except the moon
// disappears. The state is component-local and deliberately never written to the electron store —
// Annelyse's spec says a poem must not save its focus mode status, so save-and-close in focus mode
// reopens in regular Edit mode, which follows from there being nothing persisted to read back.
// The state lives in the editor page itself: opening or creating a poem inside the running window
// keeps focus mode (it is the same session at the same screen); a fresh window starts regular.
export default function useFocusMode() {
  const [focused, setFocused] = useState(false);

  const toggle = useCallback(() => setFocused((on) => !on), []);

  // The menu's checkbox owns its mark the way Check Spelling's does (menu.ts): the click has
  // already flipped it when the message arrives, so `on` says what the poet asked for. An unknown
  // value leaves the screen alone — the mark may have been flipped without anything to apply, and
  // a wrong hide is worse than no hide.
  useEffect(
    () =>
      window.electron.ipcRenderer.on('set-focus-mode', (on) => {
        if (typeof on === 'boolean') setFocused(on);
      }),
    []
  );

  return { focused, toggle };
}
