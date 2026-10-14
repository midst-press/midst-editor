import { useEffect, useState } from 'react';
import { fontSizeOrDefault, MAX_FONT_SIZE, MIN_FONT_SIZE } from 'main/fontSize';

// The text size a screen shows: read from the store once, stepped by its own buttons (stored as a
// string, as the main process stores it) and set by the View menu through 'set-font-size'.
export default function useFontSize() {
  const [size, setSize] = useState(() =>
    fontSizeOrDefault(window.electron.store.get('font-size'))
  );

  useEffect(
    () =>
      window.electron.ipcRenderer.on('set-font-size', (newSize) =>
        setSize(Number(newSize))
      ),
    []
  );

  const step = (by: number) => {
    const next = size + by;
    if (next < MIN_FONT_SIZE || next > MAX_FONT_SIZE) return;
    window.electron.store.set('font-size', String(next));
    setSize(next);
  };

  return {
    size,
    increase: () => step(1),
    decrease: () => step(-1),
    canIncrease: size < MAX_FONT_SIZE,
    canDecrease: size > MIN_FONT_SIZE,
  };
}
