import { MutableRefObject, useCallback, useEffect, useRef } from 'react';

// A save this long after the last change.
const AUTOSAVE_MS = 1000;
// And while typing goes on without that pause, a save at least this long after the first unsaved change (#315): an
// untitled poem's recovery copy, and a saved poem's own file, are never more than this far behind the poet.
const AUTOSAVE_CEILING_MS = 10000;

// Saving a second after the poet stops typing, or ten seconds after the first unsaved change if they never stop.
// `schedule` replaces the pending save; `cancel` drops it; unmounting drops it too. The timer is a ref: holding it in state re-rendered the
// editor on every keystroke and re-registered the listeners that cleared it.
//
// The generation captured when a save is scheduled identifies the document being typed into: if a
// file is opened before the timer fires, `gen` has moved on and the write is abandoned rather than
// carrying this poem's text to the newly opened file's path. There is no lock and nothing to release,
// so this cannot wedge saving -- the worst case is a write that proceeds, which is the behaviour
// without the check.
export default function useAutosave(
  latest: MutableRefObject<{ gen: number }>,
  save: () => void
) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // When the save for the first change not yet saved must happen, at the latest.
  const deadline = useRef<number | undefined>(undefined);

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    deadline.current = undefined;
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    const now = Date.now();
    if (deadline.current === undefined)
      deadline.current = now + AUTOSAVE_CEILING_MS;
    const delay = Math.max(0, Math.min(AUTOSAVE_MS, deadline.current - now));
    const genAtSchedule = latest.current.gen;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      deadline.current = undefined;
      if (latest.current.gen !== genAtSchedule) {
        window.electron.log.warn(
          'autosave abandoned: the document changed after the save was scheduled'
        );
        return;
      }
      // No arguments, so the caller's ref supplies the document as it stands when the timer fires.
      // Passing the document when scheduling saved the text from BEFORE the last keystroke.
      save();
    }, delay);
  }, [latest, save]);

  useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
}
