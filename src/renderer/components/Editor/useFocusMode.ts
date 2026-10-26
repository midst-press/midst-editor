import { useCallback, useEffect, useState } from 'react';

// Focus Mode (GitHub #25): a minimalist writing view where every interface option except the moon
// disappears. The state's one owner is main — the Edit menu's mark is the state, kept in the
// built menu and never in the store (menu.ts; cora & vivian, #327: two copies drift apart, one
// copy cannot). This hook holds no copy of the state either: the screen follows main's last word.
//
// The moon asks (focus-mode-requested) and hears the answer on the channel every other part of
// the app hears it on (set-focus-mode) — as set-filename answers an open (App.tsx). An editor
// mounting after the mode changed — Replay and back, where this page unmounted — asks where the
// screen stands (focus-mode-changed) and is answered the same way, from the menu's mark.
//
// Reopening a saved poem is regular Edit mode because nothing is persisted across a relaunch:
// main's memory ends with the app, and the store never sees focus mode.
export default function useFocusMode() {
  const [focused, setFocused] = useState(false);

  const toggle = useCallback(() => {
    // The house call shape: an args array, as LandingDialog sends 'new-file' (preload.ts).
    window.electron.ipcRenderer.sendMessage('focus-mode-requested', []);
  }, []);

  // The menu has already moved its mark when its click sent this (menu.ts owns both); an unknown
  // value leaves the screen alone — a wrong hide is worse than no hide.
  useEffect(
    () =>
      window.electron.ipcRenderer.on('set-focus-mode', (on) => {
        if (typeof on === 'boolean') setFocused(on);
      }),
    []
  );

  // Asking on mount is what makes the screen and the mark agree after Replay and back: main
  // answers from the menu, and the answer is the state the screen must show.
  useEffect(() => {
    window.electron.ipcRenderer.sendMessage('focus-mode-changed', []);
  }, []);

  return { focused, toggle };
}
