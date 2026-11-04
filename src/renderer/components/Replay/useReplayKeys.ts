import { RefObject, useEffect } from 'react';

// Replay's keys: Escape back to Edit, Space to play or pause, and Enter to play or pause when no control has
// the focus.
//
// Space plays or pauses (#374, GitHub #98), with the drafts list open or not, and is cancelled. A button clicked with
// the mouse used to keep the focus, and Chromium clicks a focused button, or turns a focused switch over, when Space
// comes back up. That undid every Space on Play after a click, turned Follow the writing and Show timestamp over, and
// drew the focus ring. A held Space repeats; only its first press counts. With a modifier it is not ours.
//
// So a button or switch clicked with the mouse gives up the focus: Space after it plays instead of working the
// control again, and no ring is drawn (Chromium shows the focus ring on a focused control once a key is pressed,
// the "red circle" of GitHub #98, in the system accent colour). A click from the keyboard (detail 0) leaves the
// focus where it is, so a keyboard user keeps both the focus and the ring.
//
// A control that still has the focus was reached from the keyboard, so Space and Enter belong to it, as everywhere
// else: Tab reaches every button and switch. With no control focused, Space plays or pauses, and so does Enter
// unless the drafts list is open.
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
      // A control that has the focus was reached from the keyboard (a mouse click gives it up, below), so Space and
      // Enter work it: a switch turns over on Space and ignores Enter (cora-2f1e43dc, review of 36eb9b5). The slider
      // is not a control here: it takes no Space or Enter.
      const onControl = Boolean(
        target?.closest?.(CONTROL) && !target.closest('input[type="range"]')
      );
      if (onControl) return;
      if (e.key === ' ' || (e.key === 'Enter' && !listOpen)) {
        e.preventDefault();
        if (!e.repeat) playPauseButton.current?.click();
      }
    }

    // After the control's own handler, so focus it moved elsewhere (a name field opening) is left alone. The control
    // is found on the event's path, fixed when the click was dispatched: Play's icon is swapped for Pause's by then,
    // so the clicked icon is no longer inside the button and closest() from it finds nothing (GitHub #98, 4 Nov).
    function handleClick(e: MouseEvent) {
      if (e.detail === 0) return;
      const control = e.composedPath().find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement &&
          // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS selector, not text for the poet
          node.matches('button, input[type="checkbox"]')
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
