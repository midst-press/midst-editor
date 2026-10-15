import { useEffect, useRef, useState } from 'react';
import './FindBar.css';

// Edit > Find is in the menu on every screen, but only the writing window has a find bar. A screen
// without one renders this with its own words, so the shortcut says why instead of doing nothing.

export const FIND_IN_REPLAY = (isMac: boolean) =>
  `Find works while you are writing. Press Edit, or ${
    isMac ? 'Command+T' : 'Ctrl+T'
  }, to go back to the poem.`;
export const FIND_BEFORE_OPEN = 'Find works once a poem is open.';
// How long the message stays, in milliseconds.
export const SHOWN_FOR = 8000;

export default function FindNotHere({ message }: { message: string }) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Shown when Edit > Find is chosen, from the handler itself rather than an effect (GitHub #44). Choosing it
  // again restarts the time.
  useEffect(() => {
    const stop = window.electron.ipcRenderer.on('find-in-poem', () => {
      clearTimeout(timer.current);
      setShown(true);
      timer.current = setTimeout(() => setShown(false), SHOWN_FOR);
    });
    return () => {
      stop();
      clearTimeout(timer.current);
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="find-not-here" role="alert">
      {message}
    </div>
  );
}
