import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  changeStoredMarkers,
  MetaStore,
  readStoredMeta,
} from '../tracking/markerStore';
import { fontFamilyOf, poemFontStack, withFontFamily } from './poemFont';

// The open poem's font, shared by the editor, Replay and the font picker. The main process holds the
// document's `meta` in the store; this reads it there on open, and a choice is written there,
// counted as an unsaved change and saved, as a draft-marker change is (markerStore.ts).

export type ChooseResult = 'saved' | 'meta-unreadable';

export interface PoemFont {
  family: string | null;
  // eslint-disable-next-line no-unused-vars -- the name says what the argument is
  choose: (family: string | null) => ChooseResult;
}

export const PoemFontContext = createContext<PoemFont>({
  family: null,
  choose: () => 'meta-unreadable',
});

export const usePoemFont = () => useContext(PoemFontContext);

const storedFamily = (store: MetaStore | undefined): string | null => {
  if (!store) return null;
  const meta = readStoredMeta(store);
  return meta === null ? null : fontFamilyOf(meta);
};

// The editor's own autosave is what writes the poem; this asks for a save of the store as it is, so
// the new font is written even when the poet types nothing more.
const saveDocument = () =>
  window.electron.ipcRenderer.sendMessage('save-file', []);

// App calls this before it checks that the preload ran, so it must work without window.electron.
export function usePoemFontState(
  store: MetaStore | undefined = window.electron?.store
): PoemFont {
  const [family, setFamily] = useState(() => storedFamily(store));

  // Another poem was opened, or a new one started (both arrive as 'open-file'): the main process has
  // already stored its meta.
  useEffect(
    () =>
      window.electron?.ipcRenderer.on('open-file', () =>
        setFamily(storedFamily(store))
      ),
    [store]
  );

  // The editor and Replay take the poem's font from `--poem-font` (Editor.css, Replay.css). Set on the
  // document's root, so both screens follow it, and set as a property, never written into CSS text.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--poem-font',
      poemFontStack(family)
    );
  }, [family]);

  const choose = useCallback(
    (next: string | null): ChooseResult => {
      if (!store) return 'meta-unreadable';
      const result = changeStoredMarkers(
        store,
        (meta) => withFontFamily(meta, next),
        saveDocument
      );
      if (!result.ok) return 'meta-unreadable';
      setFamily(next);
      return 'saved';
    },
    [store]
  );

  return useMemo(() => ({ family, choose }), [family, choose]);
}
