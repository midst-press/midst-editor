import { RefObject, useEffect } from 'react';

// Replay's keys: Escape back to Edit, and Space or Enter to play or pause.
//
// While the drafts list is open, the keys belong to it and not to playback: Space and Enter would start the
// poem playing beside the list. Escape closes the list from wherever the focus is, the timeline and the
// list's switches included; in the name field it also keeps the old name. The list is not a modal (#313), so
// this asks whether it is open, not where the focus is. Closed from inside, the focus goes back to the Drafts
// button, as the modal's did, rather than to the page: after the list has gone, so the name field is not
// blurred first and does not save what was typed.
export default function useReplayKeys(
  playPauseButton: RefObject<HTMLButtonElement | null>,
  // eslint-disable-next-line no-unused-vars -- the name says what the argument is
  closeDrafts: (fromList: boolean) => void,
  backToEdit: () => void
) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (document.querySelector('.DraftDrawer')) {
        if (e.key === 'Escape') {
          const fromList = (e.target as HTMLElement | null)?.closest?.(
            '.DraftDrawer'
          );
          closeDrafts(Boolean(fromList));
        }
        return;
      }
      // Text entry keeps its keys. The slider is an input too, but takes no Space, Enter or Escape, and it keeps
      // the focus after a scrub, so it must not swallow them (#237).
      if (
        (e.target as HTMLElement | null)?.closest?.(
          'textarea, input:not([type="range"])'
        )
      )
        return;
      if (e.key === 'Escape') {
        backToEdit();
      }
      if (e.key === 'Enter' || e.key === ' ') {
        playPauseButton.current?.click();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [playPauseButton, closeDrafts, backToEdit]);
}
