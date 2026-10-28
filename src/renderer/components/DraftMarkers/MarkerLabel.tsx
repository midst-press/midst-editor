import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { i18n } from '../../../shared/i18n';

/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
interface Props {
  index: number;
  label: string;
  // This marker's name is open for typing on the timeline.
  naming: boolean;
  onJump: (index: number) => void;
  onStartNaming: (index: number) => void;
  // Enter, or leaving the field: keep what was typed. Only Enter is a choice to be done (GitHub #95).
  onFinish: (index: number, name: string, how: 'enter' | 'blur') => void;
  // Escape: keep the name it had.
  onCancel: (index: number) => void;
  onDelete: (index: number) => void;
}
/* eslint-enable no-unused-vars */

// The timeline's slider moves to wherever it is pressed, so a press on a name must not reach it: the click jumps to
// the marker's own frame instead, exactly (GitHub #95).
const keepFromSlider = (e: SyntheticEvent) => e.stopPropagation();

// A Draft Marker's name on the timeline (GitHub #95): click to go to its frame, double-click to rename it there,
// right-click (Control-click on a Mac) to delete it. Its name is typed in place when it is new.
export default function MarkerLabel({
  index,
  label,
  naming,
  onJump,
  onStartNaming,
  onFinish,
  onCancel,
  onDelete,
}: Props) {
  const [typed, setTyped] = useState(label);
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(
    null
  );
  // Enter and Escape both end the typing; the blur that follows must not count a second time.
  const [done, setDone] = useState(false);
  const [typingFor, setTypingFor] = useState(naming);
  if (naming !== typingFor) {
    setTypingFor(naming);
    if (naming) {
      setTyped(label);
      setDone(false);
    }
  }

  if (naming) {
    return (
      <input
        className="draft-mark-name"
        aria-label={i18n._('drafts.nameField')}
        // The poet has just made this marker, or asked to rename it.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={typed}
        size={Math.max(typed.length, 4)}
        onMouseDown={keepFromSlider}
        onChange={(e) => setTyped(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- how naming ended, not text for the poet
          if (!done) onFinish(index, typed, 'blur');
        }}
        onKeyDown={(e) => {
          // The timeline's own keys (Space and Enter play, Escape leaves) are not for the name field.
          e.stopPropagation();
          if (e.key === 'Enter') {
            setDone(true);
            // eslint-disable-next-line lingui/no-unlocalized-strings -- how naming ended, not text for the poet
            onFinish(index, typed, 'enter');
          }
          if (e.key === 'Escape') {
            setDone(true);
            onCancel(index);
          }
        }}
      />
    );
  }
  return (
    <>
      <button
        type="button"
        className="draft-mark-label"
        onMouseDown={keepFromSlider}
        onClick={() => onJump(index)}
        // Enter and Space press this button; they must not also play the poem.
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
        }}
        onDoubleClick={() => onStartNaming(index)}
        onContextMenu={(e) => {
          e.preventDefault();
          // From the keyboard (the Menu key, or Shift+F10 on Windows) there is no pointer: open it at the name.
          if (e.clientX === 0 && e.clientY === 0) {
            const box = e.currentTarget.getBoundingClientRect();
            setMenuAt({ top: box.bottom, left: box.left });
          } else setMenuAt({ top: e.clientY, left: e.clientX });
        }}
      >
        {label}
      </button>
      <Menu
        open={menuAt !== null}
        onClose={() => setMenuAt(null)}
        // eslint-disable-next-line lingui/no-unlocalized-strings -- a placement option, not text for the poet
        anchorReference="anchorPosition"
        anchorPosition={menuAt ?? undefined}
        // The menu is drawn elsewhere in the page but is still inside the slider for React's events.
        onMouseDown={keepFromSlider}
      >
        <MenuItem
          onClick={() => {
            setMenuAt(null);
            onDelete(index);
          }}
        >
          {i18n._('drafts.delete')}
        </MenuItem>
      </Menu>
    </>
  );
}
