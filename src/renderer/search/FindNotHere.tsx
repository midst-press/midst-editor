import { useEffect, useRef, useState } from 'react';
import './FindBar.css';
import { i18n } from '../../shared/i18n';

// Edit > Find is in the menu on every screen, but only the writing window has a find bar. A screen
// without one renders this with its own words, so the shortcut says why instead of doing nothing.

// The shortcut is the menu's accelerator, written as Electron writes it, so it stays as it is in every language.
export const findInReplay = (isMac: boolean) =>
  i18n._('find.inReplay', { shortcut: isMac ? 'Command+T' : 'Ctrl+T' });
export const findBeforeOpen = () => i18n._('find.beforeOpen');
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
