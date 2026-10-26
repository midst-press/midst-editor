import { useCallback, useEffect, useState } from 'react';

// Focus Mode (GitHub #25): a minimalist writing view where every interface option except the moon
// disappears. The state's one owner is main, in menu.ts's memory — never in the store (cora &
// vivian, #327: two copies drift apart, one copy cannot). This hook holds no copy of the state
// either: the screen follows main's last word.
//
// The moon asks (focus-mode-requested) and hears the answer on the channel every other part of
// the app hears it on (set-focus-mode) — as set-filename answers an open (App.tsx). An editor
// mounting asks where the screen stands (focus-mode-changed) and is answered the same way: this
// is what reveals the screen after Replay and back, where /editor and /replay are sibling
// routes and this page remounts (vivian at 2b3758b), and the mode has waited in main.
//
// Reopening a saved poem is regular Edit mode because the mark leaves with the window (main.ts's
// 'closed' handler) and nothing is persisted: the store never sees focus mode, and main's memory
// ends with the app.
export default function useFocusMode() {
  const [focused, setFocused] = useState(false);

  const toggle = useCallback(() => {
    // The house call shape: an args array, as LandingDialog sends 'new-file' (preload.ts).
    window.electron.ipcRenderer.sendMessage('focus-mode-requested', []);
  }, []);

  // The menu's click moved main's memory before it sent this (menu.ts); an unknown value leaves
  // the screen alone — a wrong hide is worse than no hide.
  useEffect(
    () =>
      window.electron.ipcRenderer.on('set-focus-mode', (on) => {
        if (typeof on === 'boolean') setFocused(on);
      }),
    []
  );

  // Asking on mount is what makes the screen agree with main after Replay and back: the answer
  // is the state the screen must show — and it is what the window's 'closed' reset answers to,
  // a regular Edit mode.
  useEffect(() => {
    window.electron.ipcRenderer.sendMessage('focus-mode-changed', []);
  }, []);

  return { focused, toggle };
}
