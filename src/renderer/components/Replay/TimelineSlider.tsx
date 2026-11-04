import Slider from '@mui/material/Slider';
import { format } from 'date-fns';
import { ChangeObj } from '@midst-press/midst-format/history';
import { cssVar } from '../../cssVars';
import MarkerLabel from '../DraftMarkers/MarkerLabel';

/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
interface TimelineSliderProps {
  poemHistory: ChangeObj[];
  maxStep: number;
  step: number;
  // The slider was moved to this frame, by drag, click or key.
  onScrub: (step: number) => void;
  showTimestamp: boolean;
  markers: { index: number; label: string }[];
  showMarkers: boolean;
  showLabels: boolean;
  // The frame whose marker is being named on the timeline, or null.
  naming: number | null;
  // The frame of a marker made just now and not yet named, or null.
  newMarker: number | null;
  // The names go below the line, leaving the timestamp above it (GitHub #95).
  namesBelow: boolean;
  onJump: (index: number) => void;
  // Which marker is being named on the timeline: null for none.
  setNaming: (index: number | null) => void;
  // Naming ended: `goBack` is whether a marker made in Edit mode returns there.
  onLeaveNaming: (goBack: boolean) => void;
  onRename: (index: number, name: string) => void;
  onDelete: (index: number) => void;
  onUndoNew: (index: number) => void;
}
/* eslint-enable no-unused-vars */

// Replay's timeline: one position per frame of the history, with the Draft Markers on it and their names
// above it, where they are named, renamed and deleted (GitHub #95).
export default function TimelineSlider({
  poemHistory,
  maxStep,
  step,
  onScrub,
  showTimestamp,
  markers,
  showMarkers,
  showLabels,
  naming,
  newMarker,
  namesBelow,
  onJump,
  setNaming,
  onLeaveNaming,
  onRename,
  onDelete,
  onUndoNew,
}: TimelineSliderProps) {
  const handleChange = (_event: Event, value: number | number[]) => {
    const next = Array.isArray(value) ? value[0] : value;
    if (next > maxStep || next < 0) return;
    onScrub(next);
  };
  // The time on the timeline: always shown when the poet asks in Settings (GitHub #94), otherwise only while
  // pointing at the dot, and never with no history.
  let timestampDisplay: 'on' | 'auto' | undefined;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- the slider's display modes, not text for the poet
  if (poemHistory.length) timestampDisplay = showTimestamp ? 'on' : 'auto';
  const labelFormatter = (x: number) => {
    if (x > maxStep) return '';
    return poemHistory[x]
      ? format(new Date(poemHistory[x].t), 'p\n MM/dd/yy')
      : '';
  };
  // A Draft Marker's name on the timeline (GitHub #95).
  const markLabel = (index: number, label: string) => (
    <MarkerLabel
      index={index}
      label={label}
      naming={naming === index}
      isNew={newMarker === index}
      onJump={onJump}
      onStartNaming={(at) => {
        onJump(at);
        setNaming(at);
      }}
      onFinish={(at, name, how) => {
        onRename(at, name);
        // eslint-disable-next-line lingui/no-unlocalized-strings -- how naming ended, not text for the poet
        onLeaveNaming(how === 'enter');
      }}
      // Escape keeps the name it had.
      onCancel={() => onLeaveNaming(true)}
      onDelete={(at) => {
        if (naming === at) setNaming(null);
        onDelete(at);
      }}
      onUndoNew={onUndoNew}
    />
  );
  return (
    <Slider
      min={0}
      max={maxStep}
      value={step}
      step={1}
      size="small"
      valueLabelFormat={labelFormatter}
      valueLabelDisplay={timestampDisplay}
      sx={{
        color: cssVar('onControlBar'),
        marginRight: '15px',
        cursor: poemHistory.length ? undefined : 'not-allowed',
        // MUI leaves room under a slider with mark labels; the names are placed by hand, so the line keeps to the
        // middle of the bar either way (GitHub #95).
        '&.MuiSlider-marked': { marginBottom: 0 },
        // A named marker is a speech bubble, its point on the line, like the timestamp's (GitHub #95). With the
        // names turned off, a tick in the bubble's colours shows where each marker is.
        '& .MuiSlider-mark': showLabels
          ? { display: 'none' }
          : {
              height: '14px',
              width: '3px',
              backgroundColor: cssVar('surface'),
              border: `1px solid ${cssVar('primaryDark')}`,
              borderRadius: '1px',
            },
        // As far from the line as the timestamp is, above it or below it. Above the dot, so the timestamp passes
        // behind the names where they meet; the names themselves are styled in Replay.css.
        '& .MuiSlider-markLabel': {
          top: namesBelow ? '30px' : '-2px',
          transform: namesBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)',
          transition: 'top 0.2s ease, transform 0.2s ease',
          fontSize: '0.75rem',
          zIndex: 2,
        },
        '@media (prefers-reduced-motion: reduce)': {
          '& .MuiSlider-markLabel': { transition: 'none' },
        },
      }}
      className={namesBelow ? 'names-below' : 'names-above'}
      onChange={handleChange}
      // MUI hides mark labels from assistive technology; these are buttons and a name field now
      // (GitHub #95), so they must be reachable.
      slotProps={{ markLabel: { 'aria-hidden': undefined } }}
      marks={
        // A marker being named shows even with the markers turned off.
        showMarkers || naming !== null
          ? markers
              .filter(({ index }) => showMarkers || index === naming)
              .map(({ index, label }) => ({
                value: index,
                // A name being typed shows even with the names turned off.
                label:
                  showLabels || naming === index
                    ? markLabel(index, label)
                    : undefined,
              }))
          : false
      }
    />
  );
}
