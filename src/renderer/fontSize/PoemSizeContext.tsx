import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  fontSizeAbove,
  fontSizeBelow,
  lastUsedFontSize,
  shownFontSize,
} from 'main/fontSize';
import { changeStoredMarkers, readStoredMeta } from '../tracking/markerStore';
import { StoreSchema } from '../../shared/storeSchema';
import { fontSizeOf, withFontSize } from './poemSize';

// The open poem's text size (editor #390, GitHub #105), shared by the editor, Replay and the View menu.
// A poem with `meta.fontSize` is shown at it. A poem without one is shown at the last size the poet used
// (the store's 'font-size'), as every poem was before #390, and nothing is written into it until the
// poet changes its size. A change is written into the document's `meta`, counted as an unsaved change
// and saved, as a font choice is (PoemFontContext.tsx), and it becomes the last size used.

/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
export interface SizeStore {
  get(key: 'meta' | 'font-size'): unknown;
  set<K extends 'meta' | 'edited' | 'font-size'>(
    key: K,
    value: StoreSchema[K]
  ): unknown;
}
/* eslint-enable no-unused-vars */

export interface PoemSize {
  size: number;
  increase: () => void;
  decrease: () => void;
  canIncrease: boolean;
  canDecrease: boolean;
}

export const PoemSizeContext = createContext<PoemSize | null>(null);

const storedSize = (store: SizeStore | undefined): number => {
  if (!store) return lastUsedFontSize(undefined);
  const meta = readStoredMeta(store);
  const own = meta === null ? null : fontSizeOf(meta);
  return own ?? lastUsedFontSize(store.get('font-size'));
};

// As for the font: the editor's autosave writes the poem; this asks for a save of the store as it is,
// so the new size is written even when the poet types nothing more.
const saveDocument = () =>
  window.electron.ipcRenderer.sendMessage('save-file', []);

// App calls this before it checks that the preload ran, so it must work without window.electron.
export function usePoemSizeState(
  store: SizeStore | undefined = window.electron?.store
): PoemSize {
  const [size, setSize] = useState(() => storedSize(store));

  // Another poem was opened, or a new one started: the main process has already stored its meta.
  useEffect(
    () =>
      window.electron?.ipcRenderer.on('open-file', () =>
        setSize(storedSize(store))
      ),
    [store]
  );

  // The editor and Replay take the size from `--poem-size` (Editor.css, Replay.css), set on the
  // document's root as the font is.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--poem-size',
      `${shownFontSize(size)}px`
    );
  }, [size]);

  const stepTo = useCallback(
    (next: number | null) => {
      if (!store || next === null) return;
      const result = changeStoredMarkers(
        store,
        (meta) => withFontSize(meta, next),
        saveDocument
      );
      // A meta that cannot be read is left alone, size included, as a font choice would be.
      if (!result.ok) return;
      store.set('font-size', String(next));
      setSize(next);
    },
    [store]
  );

  const increase = useCallback(
    () => stepTo(fontSizeAbove(size)),
    [stepTo, size]
  );
  const decrease = useCallback(
    () => stepTo(fontSizeBelow(size)),
    [stepTo, size]
  );

  // The View menu's Increase and Decrease text size, and Command+= and Command+-.
  useEffect(
    () =>
      window.electron?.ipcRenderer.on('step-font-size', (direction) =>
        direction === 'up' ? increase() : decrease()
      ),
    [increase, decrease]
  );

  return useMemo(
    () => ({
      size,
      increase,
      decrease,
      canIncrease: fontSizeAbove(size) !== null,
      canDecrease: fontSizeBelow(size) !== null,
    }),
    [size, increase, decrease]
  );
}

export const usePoemSize = (): PoemSize => {
  const value = useContext(PoemSizeContext);
  if (value === null)
    throw new Error('usePoemSize needs a PoemSizeContext.Provider');
  return value;
};
