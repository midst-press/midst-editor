import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { useEffect, useState } from 'react';
import { ShownMarker } from 'renderer/tracking/draftMarkers';

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
  showMarkers: boolean;
  setShowMarkers: (show: boolean) => void;
  showLabels: boolean;
  setShowLabels: (show: boolean) => void;
}
/* eslint-enable no-unused-vars */

// The list of drafts, newest first, as the original editor's drawer had it: choose one to go to that
// moment, rename it, or delete it (at once, with no question, as the original did).
export default function DraftDrawer({
  open,
  onClose,
  markers,
  naming,
  setNaming,
  onJump,
  onRename,
  onDelete,
  showMarkers,
  setShowMarkers,
  showLabels,
  setShowLabels,
}: Props) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const marker = markers.find(({ index }) => index === naming);
    if (marker) setTyped(marker.label);
    // Only when a different marker is opened for naming, not on every change to the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naming]);

  const finishNaming = (index: number) => {
    onRename(index, typed);
    setNaming(null);
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <div className="DraftDrawer" aria-label="Drafts">
        <h2>Drafts</h2>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showMarkers}
              onChange={(e) => setShowMarkers(e.target.checked)}
            />
          }
          label="Show markers on the timeline"
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
          }
          label="Show their names"
        />
        {markers.length === 0 ? <p>No drafts marked yet.</p> : null}
        <ul>
          {[...markers].reverse().map((marker) => (
            <li key={marker.index}>
              {naming === marker.index ? (
                <input
                  aria-label="Draft name"
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
                aria-label="Rename draft"
                onClick={() => setNaming(marker.index)}
              >
                <EditIcon fontSize="small" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Delete draft"
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
