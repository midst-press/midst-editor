import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createMarker,
  deleteMarker,
  MarkerResult,
  Meta,
  renameMarker,
  shownMarkers,
} from 'renderer/tracking/draftMarkers';
import {
  changeStoredMarkers,
  readStoredMeta,
} from 'renderer/tracking/markerStore';

// The original editor showed its timeline, and so allowed a draft marker, only once a poem had more
// than this many recorded changes.
export const FRAMES_BEFORE_MARKERS = 50;

// The open document's draft markers, and the three changes a poet can make to them. `save` writes the
// document; each accepted change calls it.
export default function useDraftMarkers(
  historyLength: number,
  save: () => void
) {
  const [meta, setMeta] = useState<Meta | null>(() =>
    readStoredMeta(window.electron.store)
  );
  // Another document was opened: the main process has already stored its meta.
  useEffect(
    () =>
      window.electron.ipcRenderer.on('open-file', () =>
        setMeta(readStoredMeta(window.electron.store))
      ),
    []
  );

  const apply = useCallback(
    // eslint-disable-next-line no-unused-vars
    (change: (current: Meta) => MarkerResult) => {
      const result = changeStoredMarkers(window.electron.store, change, save);
      if (result.ok) setMeta(result.meta);
      return result.ok;
    },
    [save]
  );

  const markers = useMemo(
    () => (meta ? shownMarkers(meta, historyLength) : []),
    [meta, historyLength]
  );
  const canCreateAt = useCallback(
    (index: number) =>
      historyLength > FRAMES_BEFORE_MARKERS &&
      index >= 0 &&
      index < historyLength &&
      !markers.some((marker) => marker.index === index),
    [historyLength, markers]
  );
  const create = useCallback(
    (index: number) =>
      historyLength > FRAMES_BEFORE_MARKERS &&
      apply((current) => createMarker(current, index, historyLength)),
    [apply, historyLength]
  );
  const rename = useCallback(
    (index: number, name: string) =>
      apply((current) => renameMarker(current, index, name)),
    [apply]
  );
  const remove = useCallback(
    (index: number) => apply((current) => deleteMarker(current, index)),
    [apply]
  );

  return { markers, canCreateAt, create, rename, remove };
}
