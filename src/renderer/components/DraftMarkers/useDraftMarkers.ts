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

// How a draft button looks when a draft cannot be marked. Inline, so it wins over the replay's inline colour and the
// editor's .icon-button colour, neither of which changes when the button is disabled (GitHub #66).
export const UNAVAILABLE_STYLE = {
  opacity: 0.38,
  cursor: 'not-allowed',
} as const;

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
  // Why a draft cannot be marked at `index`, in words for the poet, or null when it can. The editor and
  // the replay both show it on their disabled button (GitHub #66).
  const reasonAt = useCallback(
    (index: number): string | null => {
      if (historyLength <= FRAMES_BEFORE_MARKERS) {
        return `A draft can be marked once the poem has more than ${FRAMES_BEFORE_MARKERS} changes. This one has ${historyLength}.`;
      }
      if (index < 0 || index >= historyLength) {
        return 'There is no moment here to mark.';
      }
      if (markers.some((marker) => marker.index === index)) {
        return 'This moment already has a draft.';
      }
      return null;
    },
    [historyLength, markers]
  );
  const canCreateAt = useCallback(
    (index: number) => reasonAt(index) === null,
    [reasonAt]
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

  return { markers, reasonAt, canCreateAt, create, rename, remove };
}
