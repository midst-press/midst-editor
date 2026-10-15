import { useEffect, useState } from 'react';
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
  // Counts the times Edit > Find was chosen, so choosing it again restarts the timer.
  const [asked, setAsked] = useState(0);
  const [shown, setShown] = useState(false);

  useEffect(
    () =>
      window.electron.ipcRenderer.on('find-in-poem', () =>
        setAsked((n) => n + 1)
      ),
    []
  );

  useEffect(() => {
    if (!asked) return undefined;
    setShown(true);
    const timer = setTimeout(() => setShown(false), SHOWN_FOR);
    return () => clearTimeout(timer);
  }, [asked]);

  if (!shown) return null;
  return (
    <div className="find-not-here" role="alert">
      {message}
    </div>
  );
}
