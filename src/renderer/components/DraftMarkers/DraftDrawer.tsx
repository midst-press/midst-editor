import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { useState } from 'react';
import { ShownMarker } from 'renderer/tracking/draftMarkers';
import RefusalAlert from './RefusalAlert';
import { i18n } from '../../../shared/i18n';

/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
interface Props {
  open: boolean;
  onClose: () => void;
  markers: ShownMarker[];
  // The history position whose name is open for typing, if any.
  naming: number | null;
  setNaming: (index: number | null) => void;
  onJump: (index: number) => void;
  onRename: (index: number, name: string) => void;
  onDelete: (index: number) => void;
  // A draft was just deleted and can still be put back (#277).
  canUndo: boolean;
  onUndo: () => void;
  // Why the last change was refused, shown here because the drawer covers the page.
  refusal: string | null;
  showMarkers: boolean;
  setShowMarkers: (show: boolean) => void;
  showLabels: boolean;
  setShowLabels: (show: boolean) => void;
}
/* eslint-enable no-unused-vars */

// The list of drafts, newest first, as the original editor's drawer had it: choose one to go to that
// moment, rename it, or delete it. A delete happens at once, as the original did, and can be undone for a few
// seconds (#277).
export default function DraftDrawer({
  open,
  onClose,
  markers,
  naming,
  setNaming,
  onJump,
  onRename,
  onDelete,
  canUndo,
  onUndo,
  refusal,
  showMarkers,
  setShowMarkers,
  showLabels,
  setShowLabels,
}: Props) {
  const labelOf = (at: number | null) =>
    markers.find(({ index }) => index === at)?.label;
  const [typed, setTyped] = useState(() => labelOf(naming) ?? '');
  // When a different marker is opened for naming, the field starts from its name. Done while rendering,
  // not in an effect (GitHub #44), and only on that change, not on every change to the list.
  const [typedFor, setTypedFor] = useState(naming);
  if (naming !== typedFor) {
    setTypedFor(naming);
    const label = labelOf(naming);
    if (label !== undefined) setTyped(label);
  }

  const finishNaming = (index: number) => {
    onRename(index, typed);
    setNaming(null);
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <div className="DraftDrawer" aria-label={i18n._('drafts.title')}>
        <h2>{i18n._('drafts.title')}</h2>
        <RefusalAlert message={refusal} />
        {canUndo ? (
          <p role="status" className="DraftUndo">
            {i18n._('drafts.deleted')}{' '}
            <button type="button" onClick={onUndo}>
              {i18n._('drafts.undo')}
            </button>
          </p>
        ) : null}
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showMarkers}
              onChange={(e) => setShowMarkers(e.target.checked)}
            />
          }
          label={i18n._('drafts.showMarkers')}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
          }
          label={i18n._('drafts.showNames')}
        />
        {markers.length === 0 ? <p>{i18n._('drafts.none')}</p> : null}
        <ul>
          {[...markers].reverse().map((marker) => (
            <li key={marker.index}>
              {naming === marker.index ? (
                <input
                  aria-label={i18n._('drafts.nameField')}
                  // The poet has just asked to name this draft.
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onBlur={() => finishNaming(marker.index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishNaming(marker.index);
                    if (e.key === 'Escape') setNaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="draft-name"
                  onClick={() => onJump(marker.index)}
                >
                  {marker.label}
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={i18n._('drafts.rename')}
                onClick={() => setNaming(marker.index)}
              >
                <EditIcon fontSize="small" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={i18n._('drafts.delete')}
                // Keeps the name field from saving a name for the draft being deleted.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setNaming(null);
                  onDelete(marker.index);
                }}
              >
                <DeleteIcon fontSize="small" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Drawer>
  );
}
