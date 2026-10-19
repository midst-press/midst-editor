import './Replay.css';
import { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { reconstructHTML, ChangeObj } from '@midst-press/midst-format/history';
import {
  scrollParent,
  targetScrollTop,
  glideTo,
  Glide,
  gliding,
} from '@midst-press/midst-format/follow';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import BookmarksIcon from '@mui/icons-material/Bookmarks';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import Grow from '@mui/material/Grow';
import Box from '@mui/material/Box';
import { EditorContent, useEditor } from '@tiptap/react';
import poemExtensions from '@midst-press/midst-format/extensions';
import TextIncreaseIcon from '@mui/icons-material/TextIncrease';
import TextDecreaseIcon from '@mui/icons-material/TextDecrease';
import VerticalAlignCenterIcon from '@mui/icons-material/VerticalAlignCenter';
import { HistoryContext, TextContext } from 'renderer/context';
import { cssVar } from '../../cssVars';
import useFontSize from '../../fontSize/useFontSize';
import DraftDrawer from '../DraftMarkers/DraftDrawer';
import RefusalAlert from '../DraftMarkers/RefusalAlert';
import useDraftMarkers, {
  UNAVAILABLE_STYLE,
} from '../DraftMarkers/useDraftMarkers';
import useAutoscroll from './useAutoscroll';
import usePlayback from './usePlayback';
import RestartFromButton from './RestartFromButton';
import FindNotHere, { findInReplay } from '../../search/FindNotHere';
import { i18n } from '../../../shared/i18n';

export default function Replay() {
  const navigate = useNavigate();

  const { poemHistory, setPoemHistory } = useContext(HistoryContext);
  const { text: htmlString, setText: setHtmlString } = useContext(TextContext);
  const [maxStep] = useState(poemHistory.length ? poemHistory.length - 1 : 0);
  const playPauseButton = useRef<HTMLButtonElement | null>(null);
  const glide = useRef<Glide | null>(null);
  const autoscroll = useAutoscroll();
  // Read by the follow effect without re-running it: turning the setting over changes no frame.
  // Kept current by an effect, not during render. Declared before the follow effect, so it runs first.
  const following = useRef(autoscroll.on);
  useEffect(() => {
    following.current = autoscroll.on;
  }, [autoscroll.on]);
  const toggleAutoscroll = () => {
    // Turned off mid-glide: stop where it is, so playback does not wait on a scroll the poet turned off.
    if (!autoscroll.toggle() && glide.current && gliding(glide.current)) {
      cancelAnimationFrame(glide.current.frame);
      glide.current = null;
    }
  };

  const { step, setStep, playing, play, pause } = usePlayback(maxStep, glide);

  // Draft markers. A marker is saved with the text and history this view shows. The store can be
  // behind them: the editor saves a second after the last keystroke, and coming here inside that
  // second leaves the stored history shorter than this one. Saving the marker alone would then write
  // a file whose marker points past its own history.
  const saveDocument = useCallback(() => {
    window.electron.store.set('poem', htmlString);
    window.electron.store.set('history', JSON.stringify(poemHistory));
    window.electron.ipcRenderer.sendMessage('save-file', []);
  }, [htmlString, poemHistory]);
  const drafts = useDraftMarkers(poemHistory.length, saveDocument);
  const draftReason = drafts.reasonAt(step);
  // The editor sends the poet here to name a draft it has just marked.
  const nameOnArrival = (useLocation().state as { nameDraftAt?: number } | null)
    ?.nameDraftAt;
  const [naming, setNaming] = useState<number | null>(nameOnArrival ?? null);
  const [drawerOpen, setDrawerOpen] = useState(nameOnArrival !== undefined);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const heightClass = window.electron.versions.isMac
    ? 'history-height-tall'
    : 'history-height-short';

  const fontSize = useFontSize();

  const editor = useEditor({
    extensions: poemExtensions,
    content: reconstructHTML('', poemHistory, step),
    editable: false,
    parseOptions: {
      preserveWhitespace: true,
    },
    editorProps: {
      attributes: {
        class: `HistoryDisplay ${heightClass}`,
      },
    },
  });
  const handleStepChange = (_event: Event, value: number | number[]) => {
    const newStep = Array.isArray(value) ? value[0] : value;
    if (newStep > maxStep || newStep < 0) {
      return;
    }
    // Moving the slider (drag, click or key) pauses: the poet is choosing a frame, and stays on it (#237).
    pause();
    setStep(newStep);
  };
  useEffect(() => {
    if (!editor) return;
    const before = editor.state.doc;
    const newContent = reconstructHTML('', poemHistory, step);
    editor.commands.setContent(newContent, false, { preserveWhitespace: true });
    // Follow the writing: see ./follow.ts for why this does not use the recorded pos.
    const after = editor.state.doc;
    const changed = after.content.findDiffStart(before.content);
    const scroller = scrollParent(editor.view.dom as HTMLElement);
    if (following.current && changed != null && scroller) {
      const at = Math.min(changed, after.content.size);
      const point = editor.view.coordsAtPos(at);
      const to = targetScrollTop(
        point,
        scroller.getBoundingClientRect(),
        scroller.scrollTop,
        scroller.scrollHeight
      );
      if (to != null) glide.current = glideTo(scroller, to, glide.current);
    }
  }, [maxStep, step, poemHistory, editor]);

  useEffect(() => {
    // 🚨 `editor` is narrowed EXPLICITLY here rather than reached through `editor?.commands`, and
    // that is load-bearing. With the optional chain, react-hooks/exhaustive-deps asks for
    // `editor?.commands` as the dependency -- and `commands` is a GETTER returning a fresh object
    // on every access, so supplying it makes this effect re-run on every render, its setState
    // re-render, and Replay die with React error #185 (Maximum update depth exceeded), dropping the
    // reader back to the landing screen. Measured in the running app on 2026-10-09, not reasoned
    // about. Narrowing first makes the dependency `editor`, which useEditor creates once per mount,
    // so the rule is satisfied by a dependency that is genuinely stable. Do not reintroduce the
    // optional chain here.
    if (!editor) return;
    editor.commands.focus();
  }, [editor]);

  const labelFormatter = (x: number) => {
    if (x > maxStep) return '';
    return poemHistory[x]
      ? format(new Date(poemHistory[x].t), 'p\n MM/dd/yy')
      : '';
  };
  useEffect(() => {
    const removeOpen = window.electron.ipcRenderer.on(
      'open-file',
      (savedPoem, savedHistory) => {
        pause();
        setHtmlString(savedPoem as string);
        setPoemHistory(savedHistory as ChangeObj[]);
        navigate('/editor');
      }
    );

    const removeToggleEditHandler = window.electron.ipcRenderer.on(
      'toggle-edit-mode',
      () => {
        navigate('/editor');
      }
    );

    return () => {
      removeOpen();
      removeToggleEditHandler();
    };
  }, [navigate, setHtmlString, setPoemHistory, pause]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // While the drafts list is open, the keys belong to it and not to playback: Space and Enter
      // would start the poem playing behind the list, and Escape is the list's own way to close.
      // Focus sits on the drawer's panel when it opens, so this asks the drawer, not the focused element.
      if (document.querySelector('.DraftDrawer')) return;
      // Text entry keeps its keys. The slider is an input too, but takes no Space, Enter or Escape, and it keeps
      // the focus after a scrub, so it must not swallow them (#237).
      if (
        (e.target as HTMLElement | null)?.closest?.(
          'textarea, input:not([type="range"])'
        )
      )
        return;
      if (e.key === 'Escape') {
        navigate('/editor');
      }
      if (e.key === 'Enter' || e.key === ' ') {
        playPauseButton.current?.click();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    // Don't forget to clean up
    return function cleanup() {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigate]);
  return (
    <div style={{ backgroundColor: cssVar('background') }}>
      <div className="TopButtons">
        <Tooltip
          title={i18n._('textSize.increase')}
          TransitionComponent={Zoom}
          enterDelay={1000}
          arrow
        >
          <button
            aria-label={i18n._('textSize.increase')}
            type="button"
            onClick={fontSize.increase}
            disabled={!fontSize.canIncrease}
            className="icon-button size-icon"
          >
            <TextIncreaseIcon fontSize="small" />
          </button>
        </Tooltip>
        <Tooltip
          title={i18n._('textSize.decrease')}
          TransitionComponent={Zoom}
          enterDelay={1000}
          arrow
        >
          <button
            aria-label={i18n._('textSize.decrease')}
            type="button"
            disabled={!fontSize.canDecrease}
            className="icon-button size-icon"
            onClick={fontSize.decrease}
          >
            <TextDecreaseIcon fontSize="small" />
          </button>
        </Tooltip>
        <Tooltip
          title={
            autoscroll.on
              ? i18n._('replay.follow.on')
              : i18n._('replay.follow.off')
          }
          TransitionComponent={Zoom}
          enterDelay={1000}
          arrow
        >
          <button
            aria-label={i18n._('replay.follow')}
            aria-pressed={autoscroll.on}
            type="button"
            className="icon-button size-icon"
            style={autoscroll.on ? undefined : { opacity: 0.5 }}
            onClick={toggleAutoscroll}
          >
            <VerticalAlignCenterIcon fontSize="small" />
          </button>
        </Tooltip>
      </div>
      <div className={`ReplayContainer size-${fontSize.size}`}>
        <EditorContent editor={editor} />
      </div>
      <Grow mountOnEnter in>
        <Box
          component="div"
          className="ControlBar"
          style={{
            backgroundColor: cssVar('controlBar'),
          }}
        >
          <button
            type="button"
            ref={playPauseButton}
            style={{ color: cssVar('onControlBar') }}
            onClick={playing ? pause : play}
            disabled={!poemHistory.length}
            className="control-bar-icon control-icon-gap"
          >
            {playing ? (
              <PauseIcon fontSize="small" />
            ) : (
              <PlayArrowIcon fontSize="small" />
            )}
          </button>
          <Slider
            min={0}
            max={maxStep}
            value={step}
            step={1}
            size="small"
            valueLabelFormat={labelFormatter}
            valueLabelDisplay={poemHistory.length ? 'auto' : undefined}
            sx={{
              color: cssVar('onControlBar'),
              marginRight: '15px',
              cursor: poemHistory.length ? undefined : 'not-allowed',
              // Draft markers: a tick tall enough to see on the rail, and the name above the bar,
              // where there is room for it.
              '& .MuiSlider-mark': {
                height: '14px',
                width: '2px',
                backgroundColor: cssVar('textPrimary'),
                opacity: 0.7,
              },
              '& .MuiSlider-markLabel': {
                top: '-34px',
                fontSize: '0.75rem',
                color: cssVar('textPrimary'),
                maxWidth: '140px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            }}
            onChange={handleStepChange}
            marks={
              showMarkers
                ? drafts.markers.map(({ index, label }) => ({
                    value: index,
                    label: showLabels ? label : undefined,
                  }))
                : false
            }
          />
          <Tooltip
            title={draftReason ?? i18n._('drafts.mark')}
            TransitionComponent={Zoom}
            enterDelay={1000}
            arrow
            placement="top-end"
            classes={{ arrow: 'custom-arrow', tooltip: 'custom' }}
          >
            <span>
              <button
                aria-label={i18n._('drafts.mark')}
                aria-describedby={
                  draftReason ? 'replay-draft-reason' : undefined
                }
                type="button"
                className="control-bar-icon"
                style={{
                  color: cssVar('onControlBar'),
                  ...(draftReason ? UNAVAILABLE_STYLE : {}),
                }}
                disabled={draftReason !== null}
                onClick={() => {
                  pause();
                  if (drafts.create(step)) {
                    setNaming(step);
                    setDrawerOpen(true);
                  }
                }}
              >
                <BookmarkAddIcon fontSize="small" />
              </button>
              {draftReason && (
                <span id="replay-draft-reason" hidden>
                  {draftReason}
                </span>
              )}
              <RefusalAlert message={drafts.refusal} />
            </span>
          </Tooltip>
          <RestartFromButton step={step} pause={pause} />
          <Tooltip
            title={i18n._('drafts.title')}
            TransitionComponent={Zoom}
            enterDelay={1000}
            arrow
            placement="top-end"
            classes={{ arrow: 'custom-arrow', tooltip: 'custom' }}
          >
            <button
              aria-label={i18n._('drafts.title')}
              type="button"
              className="control-bar-icon"
              style={{ color: cssVar('onControlBar') }}
              onClick={() => setDrawerOpen(true)}
            >
              <BookmarksIcon fontSize="small" />
            </button>
          </Tooltip>
          <Tooltip
            title={i18n._('replay.edit')}
            TransitionComponent={Zoom}
            enterDelay={1000}
            arrow
            placement="top-end"
            classes={{ arrow: 'custom-arrow', tooltip: 'custom' }}
          >
            <Link to="/editor">
              <button
                aria-label={i18n._('replay.edit')}
                type="button"
                className="control-bar-icon"
                style={{
                  color: cssVar('onControlBar'),
                }}
              >
                <EditIcon fontSize="small" />
              </button>
            </Link>
          </Tooltip>
        </Box>
      </Grow>
      <DraftDrawer
        open={drawerOpen}
        onClose={() => {
          setNaming(null);
          setDrawerOpen(false);
        }}
        markers={drafts.markers}
        naming={naming}
        setNaming={setNaming}
        onJump={(index) => {
          pause();
          setStep(index);
        }}
        onRename={drafts.rename}
        onDelete={drafts.remove}
        refusal={drafts.refusal}
        showMarkers={showMarkers}
        setShowMarkers={setShowMarkers}
        showLabels={showLabels}
        setShowLabels={setShowLabels}
      />
      <FindNotHere message={findInReplay(window.electron.versions.isMac)} />
    </div>
  );
}
