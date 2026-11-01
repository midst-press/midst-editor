import { RefObject, useEffect } from 'react';

// Replay's keys: Escape back to Edit, Space to play or pause, and Enter to play or pause when no control has
// the focus.
//
// Space only ever plays or pauses (#374, GitHub #98), with the drafts list open or not. It is cancelled, so the
// control that has the focus does not take it as well: a button clicked with the mouse keeps the focus, and
// Chromium clicks a focused button, or turns a focused switch over, when Space comes back up. That undid every
// Space on Play after a click, turned Follow the writing and Show timestamp over, and drew the focus ring. A held
// Space repeats; only its first press counts. With a modifier it is not ours.
//
// A button or switch clicked with the mouse does not keep the focus. Cancelling Space stops it acting twice, but
// Chromium still shows the focus ring on a focused control once a key is pressed, the "red circle" of GitHub #98
// (the ring is drawn in the system accent colour). A click from the keyboard (detail 0) leaves the focus where it
// is, so a keyboard user keeps both the focus and the ring.
//
// Enter belongs to the control that has the focus, as it does everywhere else, so the keyboard still reaches the
// buttons and the list; with no control focused, it plays or pauses.
//
// Escape closes the drafts list from wherever the focus is, the timeline and the list's switches included; in the
// name field it also keeps the old name. The list is not a modal (#313), so this asks whether it is open, not
// where the focus is. Closed from inside, the focus goes back to the Drafts button, as the modal's did, rather
// than to the page: after the list has gone, so the name field is not blurred first and does not save what was
// typed. With the list closed, Escape goes back to Edit, except from text entry, which keeps it.
const CONTROL =
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS selector, not text for the poet
  'button, a[href], input, select, [role="switch"], [role="menuitem"]';

export default function useReplayKeys(
  playPauseButton: RefObject<HTMLButtonElement | null>,
  // eslint-disable-next-line no-unused-vars -- the name says what the argument is
  closeDrafts: (fromList: boolean) => void,
  backToEdit: () => void
) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const listOpen = document.querySelector('.DraftDrawer') !== null;
      if (listOpen && e.key === 'Escape') {
        closeDrafts(Boolean(target?.closest?.('.DraftDrawer')));
        return;
      }
      // Text entry keeps its keys. The slider, a switch and a checkbox are inputs too, but take no typing: the
      // slider keeps the focus after a scrub (#237), and a switch keeps it after a click (GitHub #98).
      if (
        target?.closest?.(
          'textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"])'
        )
      )
        return;
      if (e.key === 'Escape') {
        backToEdit();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) playPauseButton.current?.click();
        return;
      }
      if (e.key === 'Enter' && !listOpen) {
        // The slider is not a control here: it takes no Enter.
        if (
          target?.closest?.(CONTROL) &&
          !target.closest('input[type="range"]')
        )
          return;
        e.preventDefault();
        if (!e.repeat) playPauseButton.current?.click();
      }
    }

    // After the control's own handler, so focus it moved elsewhere (a name field opening) is left alone.
    function handleClick(e: MouseEvent) {
      if (e.detail === 0) return;
      const control = (e.target as HTMLElement | null)?.closest?.(
        'button, input[type="checkbox"]'
      );
      if (control instanceof HTMLElement && document.activeElement === control)
        control.blur();
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClick);
    };
  }, [playPauseButton, closeDrafts, backToEdit]);
}
