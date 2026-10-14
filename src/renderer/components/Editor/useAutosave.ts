import { MutableRefObject, useCallback, useEffect, useRef } from 'react';

// A save this long after the last change.
const AUTOSAVE_MS = 1000;

// Saving a second after the poet stops typing. `schedule` cancels the pending save and sets a new one;
// `cancel` drops it; unmounting drops it too. The timer is a ref: holding it in state re-rendered the
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

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const schedule = useCallback(() => {
    cancel();
    const genAtSchedule = latest.current.gen;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (latest.current.gen !== genAtSchedule) {
        window.electron.log.warn(
          'autosave abandoned: the document changed after the save was scheduled'
        );
        return;
      }
      // No arguments, so the caller's ref supplies the document as it stands when the timer fires.
      // Passing the document when scheduling saved the text from BEFORE the last keystroke.
      save();
    }, AUTOSAVE_MS);
  }, [cancel, latest, save]);

  useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
}
