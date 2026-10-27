import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createMarker,
  deleteMarker,
  DraftMarker,
  markerAt,
  MarkerRefusal,
  MarkerResult,
  Meta,
  renameMarker,
  restoreMarker,
  shownMarkers,
} from 'renderer/tracking/draftMarkers';
import {
  changeStoredMarkers,
  readStoredMeta,
} from 'renderer/tracking/markerStore';
import { i18n } from '../../../shared/i18n';

// The original editor showed its timeline, and so allowed a draft marker, only once a poem had more
// than this many recorded changes.
export const FRAMES_BEFORE_MARKERS = 50;

// Fixed log messages: what happened is in the message, the reason and positions are in the meta. Never a
// name or any poem text.
export const REFUSED_LOG = 'draft marker change refused';
export const FAILED_LOG = 'draft marker change failed';
export const REREAD_FAILED_LOG = 'draft markers could not be read back';

// How long a deleted draft can be put back (#277). A delete takes effect at once and is saved, as before;
// undoing it is a second change.
export const UNDO_MS = 5000;

export type ChangeRefusal =
  MarkerRefusal | 'meta-unreadable' | 'too-few-changes' | 'change-threw';

// What the poet is told for each refusal.
export const refusalMessage = (
  reason: ChangeRefusal,
  changes: number
): string => {
  switch (reason) {
    case 'too-few-changes':
      return i18n._('drafts.refused.tooFewChanges', {
        needed: FRAMES_BEFORE_MARKERS,
        count: changes,
      });
    case 'not-a-history-position':
      return i18n._('drafts.refused.noMoment');
    case 'position-has-a-marker':
      return i18n._('drafts.refused.alreadyMarked');
    case 'no-draft-number-left':
      return i18n._('drafts.refused.noNumberLeft');
    case 'no-marker-there':
      return i18n._('drafts.refused.gone');
    case 'meta-unreadable':
    case 'markers-unreadable':
      return i18n._('drafts.refused.unreadable');
    default:
      // It may have been kept: the change can fail after it was stored. The list shows what was.
      return i18n._('drafts.refused.failed');
  }
};

// How a draft button looks when a draft cannot be marked. Inline, so it wins over the replay's inline colour and the
// editor's .icon-button colour, neither of which changes when the button is disabled (GitHub #66).
export const UNAVAILABLE_STYLE = {
  opacity: 0.38,
  cursor: 'not-allowed',
} as const;

// The open document's draft markers, and the three changes a poet can make to them. `save` writes the
// document; each accepted change calls it. `changes` is how many changes the poet has made, which the 50 counts:
// a new poem's empty first frame is a position on the Timeline but not a change (GitHub #29).
export default function useDraftMarkers(
  historyLength: number,
  save: () => void,
  changes: number = historyLength
) {
  const [meta, setMeta] = useState<Meta | null>(() =>
    readStoredMeta(window.electron.store)
  );

  // Why the last change was refused; null after an accepted change. Kept as the reason and put into words when
  // returned, so it follows View > Language (editor #265).
  const [refused, setRefusal] = useState<{
    reason: ChangeRefusal;
    changes: number;
  } | null>(null);
  // The last delete, while it can still be undone: the marker exactly as it was, and its place in the list.
  const [deleted, setDeleted] = useState<{
    marker: DraftMarker;
    position: number;
  } | null>(null);
  useEffect(() => {
    if (deleted === null) return undefined;
    const expire = setTimeout(() => setDeleted(null), UNDO_MS);
    return () => clearTimeout(expire);
  }, [deleted]);
  // Another document was opened: the main process has already stored its meta. A message about the
  // last document's drafts no longer applies.
  useEffect(
    () =>
      window.electron.ipcRenderer.on('open-file', () => {
        setMeta(readStoredMeta(window.electron.store));
        setRefusal(null);
        // A delete in the last document cannot be undone into this one.
        setDeleted(null);
      }),
    []
  );

  // A refused change is an error, not a warning: the buttons are disabled for every refusal the poet can
  // cause, so reaching one means stale state or unreadable stored data, and the poet's action had no effect.
  const refuse = useCallback(
    (reason: ChangeRefusal, action: string, index: number) => {
      window.electron.log.error(REFUSED_LOG, {
        reason,
        action,
        index,
        historyLength,
      });
      setRefusal({ reason, changes });
      return false;
    },
    [historyLength, changes]
  );

  const apply = useCallback(
    (
      // eslint-disable-next-line no-unused-vars
      change: (current: Meta) => MarkerResult,
      action: string,
      index: number
    ) => {
      try {
        const result = changeStoredMarkers(window.electron.store, change, save);
        if (!result.ok) return refuse(result.reason, action, index);
        setMeta(result.meta);
        setRefusal(null);
        return true;
      } catch (error) {
        // Only the error's name is logged: its message may quote what was being read.
        window.electron.log.error(FAILED_LOG, {
          action,
          index,
          historyLength,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        // The change may have been stored before the throw (it writes the meta, then the unsaved flag, then
        // saves), so show what the store now holds rather than what was on screen. If that read fails too, it
        // is logged, and the list stays as it was.
        try {
          setMeta(readStoredMeta(window.electron.store));
        } catch (reread) {
          window.electron.log.error(REREAD_FAILED_LOG, {
            action,
            index,
            errorName: reread instanceof Error ? reread.name : typeof reread,
          });
        }
        setRefusal({ reason: 'change-threw', changes });
        return false;
      }
    },
    [save, refuse, historyLength, changes]
  );

  const markers = useMemo(
    () => (meta ? shownMarkers(meta, historyLength) : []),
    [meta, historyLength]
  );
  // Why a draft cannot be marked at `index`, in words for the poet, or null when it can. The editor and
  // the replay both show it on their disabled button (GitHub #66).
  const reasonAt = useCallback(
    (index: number): string | null => {
      if (changes <= FRAMES_BEFORE_MARKERS) {
        return refusalMessage('too-few-changes', changes);
      }
      if (index < 0 || index >= historyLength) {
        return refusalMessage('not-a-history-position', changes);
      }
      if (markers.some((marker) => marker.index === index)) {
        return refusalMessage('position-has-a-marker', changes);
      }
      return null;
    },
    [historyLength, changes, markers]
  );
  const canCreateAt = useCallback(
    (index: number) => reasonAt(index) === null,
    [reasonAt]
  );
  const create = useCallback(
    (index: number) =>
      changes > FRAMES_BEFORE_MARKERS
        ? apply(
            (current) => createMarker(current, index, historyLength),
            'create',
            index
          )
        : refuse('too-few-changes', 'create', index),
    [apply, refuse, historyLength, changes]
  );
  const rename = useCallback(
    (index: number, name: string) =>
      apply((current) => renameMarker(current, index, name), 'rename', index),
    [apply]
  );
  const remove = useCallback(
    (index: number) => {
      let taken: { marker: DraftMarker; position: number } | null = null;
      const done = apply(
        (current) => {
          const result = deleteMarker(current, index);
          if (result.ok) taken = markerAt(current, index);
          return result;
        },
        'delete',
        index
      );
      setDeleted(done ? taken : null);
      return done;
    },
    [apply]
  );
  const undoDelete = useCallback(() => {
    if (deleted === null) return false;
    const { marker, position } = deleted;
    setDeleted(null);
    return apply(
      (current) => restoreMarker(current, marker, position),
      'undo-delete',
      marker.index
    );
  }, [apply, deleted]);

  const refusal = refused && refusalMessage(refused.reason, refused.changes);
  return {
    markers,
    reasonAt,
    canCreateAt,
    create,
    rename,
    remove,
    canUndoDelete: deleted !== null,
    undoDelete,
    refusal,
  };
}
