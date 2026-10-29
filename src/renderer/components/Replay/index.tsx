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
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import SettingsIcon from '@mui/icons-material/Settings';
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
import MarkerLabel from '../DraftMarkers/MarkerLabel';
import RefusalAlert from '../DraftMarkers/RefusalAlert';
import useDraftMarkers, {
  UNAVAILABLE_STYLE,
} from '../DraftMarkers/useDraftMarkers';
import useAutoscroll from './useAutoscroll';
import useShowTimestamp from './useShowTimestamp';
import usePlayback from './usePlayback';
import RestartFromButton from './RestartFromButton';
import FindNotHere, { findInReplay } from '../../search/FindNotHere';
import { i18n } from '../../../shared/i18n';
import { changesMade } from '../../../shared/firstFrame';

export default function Replay() {
  const navigate = useNavigate();

  const { poemHistory, setPoemHistory } = useContext(HistoryContext);
  const { text: htmlString, setText: setHtmlString } = useContext(TextContext);
  const [maxStep] = useState(poemHistory.length ? poemHistory.length - 1 : 0);
  const playPauseButton = useRef<HTMLButtonElement | null>(null);
  const draftsButton = useRef<HTMLButtonElement | null>(null);
  const refocusDrafts = useRef(false);
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
  const drafts = useDraftMarkers(
    poemHistory.length,
    saveDocument,
    changesMade(poemHistory)
  );
  const draftReason = drafts.reasonAt(step);
  // Why a button cannot be used now, or null when it can (#273). A new poem's empty first frame is not
  // something to play (GitHub #29).
  const playReason = changesMade(poemHistory)
    ? null
    : i18n._('replay.play.unavailable');
  // The editor sends the poet here to name a draft it has just marked.
  const nameOnArrival = (useLocation().state as { nameDraftAt?: number } | null)
    ?.nameDraftAt;
  // The name being typed in Settings, if any.
  const [naming, setNaming] = useState<number | null>(null);
  // A new marker is named on the timeline itself, not in Settings (GitHub #95). Made from Edit mode, finishing
  // the name goes back to Edit; made here, it stays on that frame.
  const [timelineNaming, setTimelineNaming] = useState<number | null>(
    nameOnArrival ?? null
  );
  const backToEdit = useRef(nameOnArrival !== undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Closing the list from inside it hands the focus back to the Drafts button once the list has gone.
  useEffect(() => {
    if (!drawerOpen && refocusDrafts.current) {
      refocusDrafts.current = false;
      draftsButton.current?.focus();
    }
  }, [drawerOpen]);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const showTimestamp = useShowTimestamp();
  const heightClass = window.electron.versions.isMac
    ? 'history-height-tall'
    : 'history-height-short';

  const fontSize = useFontSize();
  const largestReason = fontSize.canIncrease
    ? null
    : i18n._('textSize.largest');
  const smallestReason = fontSize.canDecrease
    ? null
    : i18n._('textSize.smallest');

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
    editor.commands.setContent(newContent, {
      emitUpdate: false,
      parseOptions: { preserveWhitespace: true },
    });
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

  // The time on the timeline: always shown when the poet asks in Settings (GitHub #94), otherwise only while
  // pointing at the dot, and never with no history.
  let timestampDisplay: 'on' | 'auto' | undefined;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- the slider's display modes, not text for the poet
  if (poemHistory.length) timestampDisplay = showTimestamp.on ? 'on' : 'auto';
  // A Draft Marker's name on the timeline (GitHub #95).
  const jumpTo = (index: number) => {
    pause();
    setStep(index);
  };
  const leaveTimelineNaming = (goBack: boolean) => {
    setTimelineNaming(null);
    if (backToEdit.current) {
      backToEdit.current = false;
      if (goBack) navigate('/editor');
    }
  };
  const markLabel = (index: number, label: string) => (
    <MarkerLabel
      index={index}
      label={label}
      naming={timelineNaming === index}
      onJump={jumpTo}
      onStartNaming={(at) => {
        jumpTo(at);
        setTimelineNaming(at);
      }}
      onFinish={(at, name, how) => {
        drafts.rename(at, name);
        // eslint-disable-next-line lingui/no-unlocalized-strings -- how naming ended, not text for the poet
        leaveTimelineNaming(how === 'enter');
      }}
      // Escape keeps the name it had.
      onCancel={() => leaveTimelineNaming(true)}
      onDelete={(at) => {
        if (timelineNaming === at) setTimelineNaming(null);
        drafts.remove(at);
      }}
    />
  );
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
      // would start the poem playing beside the list. Escape closes the list from wherever the focus is,
      // the timeline and the list's switches included; in the name field it also keeps the old name. The
      // list is not a modal (#313), so this asks whether it is open, not where the focus is. Closed from
      // inside, the focus goes back to the Drafts button, as the modal's did, rather than to the page: after
      // the list has gone, so the name field is not blurred first and does not save what was typed.
      if (document.querySelector('.DraftDrawer')) {
        if (e.key === 'Escape') {
          const fromList = (e.target as HTMLElement | null)?.closest?.(
            '.DraftDrawer'
          );
          setNaming(null);
          setDrawerOpen(false);
          refocusDrafts.current = Boolean(fromList);
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
    // The drafts list sits beside the poem and the timeline, never over them (#313, GitHub #85).
    <div
      className="ReplayLayout"
      style={{ backgroundColor: cssVar('background') }}
    >
      <div className="ReplayMain">
        <div className="TopButtons">
          {/* At the largest or smallest size the button says so (#273, GitHub #66), as the play button does. */}
          <Tooltip
            title={largestReason ?? i18n._('textSize.increase')}
            TransitionComponent={Zoom}
            enterDelay={1000}
            arrow
          >
            <span>
              <button
                aria-label={i18n._('textSize.increase')}
                aria-describedby={
                  largestReason ? 'replay-largest-reason' : undefined
                }
                type="button"
                onClick={fontSize.increase}
                disabled={largestReason !== null}
                className="icon-button size-icon"
                style={largestReason ? UNAVAILABLE_STYLE : undefined}
              >
                <TextIncreaseIcon fontSize="small" />
              </button>
              {largestReason && (
                <span id="replay-largest-reason" hidden>
                  {largestReason}
                </span>
              )}
            </span>
          </Tooltip>
          <Tooltip
            title={smallestReason ?? i18n._('textSize.decrease')}
            TransitionComponent={Zoom}
            enterDelay={1000}
            arrow
          >
            <span>
              <button
                aria-label={i18n._('textSize.decrease')}
                aria-describedby={
                  smallestReason ? 'replay-smallest-reason' : undefined
                }
                type="button"
                disabled={smallestReason !== null}
                className="icon-button size-icon"
                style={smallestReason ? UNAVAILABLE_STYLE : undefined}
                onClick={fontSize.decrease}
              >
                <TextDecreaseIcon fontSize="small" />
              </button>
              {smallestReason && (
                <span id="replay-smallest-reason" hidden>
                  {smallestReason}
                </span>
              )}
            </span>
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
            {/* Named like every other button here (#101): a screen reader said only "button". With no history
              it cannot play and says why (#273, GitHub #66): in its tooltip, which needs the span because a
              disabled button gets no mouse events, and as its description. */}
            <Tooltip
              title={
                playReason ??
                (playing ? i18n._('replay.pause') : i18n._('replay.play'))
              }
              TransitionComponent={Zoom}
              enterDelay={1000}
              arrow
            >
              <span className="control-icon-gap">
                <button
                  type="button"
                  ref={playPauseButton}
                  aria-label={
                    playing ? i18n._('replay.pause') : i18n._('replay.play')
                  }
                  aria-describedby={
                    playReason ? 'replay-play-reason' : undefined
                  }
                  style={{
                    color: cssVar('onControlBar'),
                    ...(playReason ? UNAVAILABLE_STYLE : {}),
                  }}
                  onClick={playing ? pause : play}
                  disabled={playReason !== null}
                  className="control-bar-icon"
                >
                  {playing ? (
                    <PauseIcon fontSize="small" />
                  ) : (
                    <PlayArrowIcon fontSize="small" />
                  )}
                </button>
                {playReason && (
                  <span id="replay-play-reason" hidden>
                    {playReason}
                  </span>
                )}
              </span>
            </Tooltip>
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
                // Draft markers: a tick tall enough to see on the rail, and the name above the bar,
                // where there is room for it.
                '& .MuiSlider-mark': {
                  height: '14px',
                  width: '2px',
                  backgroundColor: cssVar('textPrimary'),
                  opacity: 0.7,
                },
                // Above the dot, so the timestamp passes behind the names where they meet (GitHub #95); the
                // names themselves are styled in Replay.css.
                '& .MuiSlider-markLabel': {
                  top: '-34px',
                  fontSize: '0.75rem',
                  zIndex: 2,
                },
              }}
              onChange={handleStepChange}
              // MUI hides mark labels from assistive technology; these are buttons and a name field now
              // (GitHub #95), so they must be reachable.
              slotProps={{ markLabel: { 'aria-hidden': undefined } }}
              marks={
                // A marker being named shows even with the markers turned off.
                showMarkers || timelineNaming !== null
                  ? drafts.markers
                      .filter(
                        ({ index }) => showMarkers || index === timelineNaming
                      )
                      .map(({ index, label }) => ({
                        value: index,
                        // A name being typed shows even with the names turned off.
                        label:
                          showLabels || timelineNaming === index
                            ? markLabel(index, label)
                            : undefined,
                      }))
                  : false
              }
            />
            {/* Continue writing from here first, then the two Draft Marker buttons, then X (GitHub #90). */}
            <RestartFromButton step={step} pause={pause} />
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
                    if (drafts.create(step)) setTimelineNaming(step);
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
                {/* A delete from the timeline can be undone here, as in Settings (#277, GitHub #95). */}
                {drafts.canUndoDelete && !drawerOpen ? (
                  <span role="status" className="DraftUndo TimelineUndo">
                    {i18n._('drafts.deleted')}{' '}
                    <button type="button" onClick={drafts.undoDelete}>
                      {i18n._('drafts.undo')}
                    </button>
                  </span>
                ) : null}
              </span>
            </Tooltip>
            <Tooltip
              title={i18n._('settings.title')}
              TransitionComponent={Zoom}
              enterDelay={1000}
              arrow
              placement="top-end"
              classes={{ arrow: 'custom-arrow', tooltip: 'custom' }}
            >
              <button
                ref={draftsButton}
                aria-label={i18n._('settings.title')}
                aria-expanded={drawerOpen}
                type="button"
                className="control-bar-icon"
                style={{ color: cssVar('onControlBar') }}
                // Opens the list, or closes it: with the list beside the page, this button stays in reach.
                onClick={() => {
                  if (drawerOpen) setNaming(null);
                  setDrawerOpen(!drawerOpen);
                }}
              >
                {/* A gear: the drafts list is now the Settings panel (GitHub #94). */}
                <SettingsIcon fontSize="small" />
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
                  {/* An X back to Edit, as Escape does (GitHub #90); its name stays Edit (GitHub #80). */}
                  <CloseIcon fontSize="small" />
                </button>
              </Link>
            </Tooltip>
          </Box>
        </Grow>
      </div>
      <DraftDrawer
        open={drawerOpen}
        markers={drafts.markers}
        naming={naming}
        setNaming={setNaming}
        onJump={(index) => {
          pause();
          setStep(index);
        }}
        onRename={drafts.rename}
        onDelete={drafts.remove}
        canUndo={drafts.canUndoDelete}
        onUndo={drafts.undoDelete}
        refusal={drafts.refusal}
        showMarkers={showMarkers}
        setShowMarkers={setShowMarkers}
        showLabels={showLabels}
        setShowLabels={setShowLabels}
        showTimestamp={showTimestamp.on}
        setShowTimestamp={showTimestamp.set}
      />
      <FindNotHere message={findInReplay(window.electron.versions.isMac)} />
    </div>
  );
}
