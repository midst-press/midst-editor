import './Replay.css';
import { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { reconstructHTML } from '@midst-press/midst-format/history';
import { Glide } from '@midst-press/midst-format/follow';
import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import SettingsIcon from '@mui/icons-material/Settings';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Grow from '@mui/material/Grow';
import Box from '@mui/material/Box';
import { EditorContent, useEditor } from '@tiptap/react';
import poemExtensions from '@midst-press/midst-format/extensions';
import { HistoryContext, TextContext } from 'renderer/context';
import { cssVar } from '../../cssVars';
import useFontSize from '../../fontSize/useFontSize';
import DraftDrawer from '../DraftMarkers/DraftDrawer';
import RefusalAlert from '../DraftMarkers/RefusalAlert';
import useDraftMarkers from '../DraftMarkers/useDraftMarkers';
import useShowTimestamp from './useShowTimestamp';
import usePlayback from './usePlayback';
import useFollowWriting from './useFollowWriting';
import useReplayKeys from './useReplayKeys';
import ReasonButton from './ReasonButton';
import ReplayTopButtons from './ReplayTopButtons';
import TimelineSlider from './TimelineSlider';
import RestartFromButton from './RestartFromButton';
import FindNotHere, { findInReplay } from '../../search/FindNotHere';
import { i18n } from '../../../shared/i18n';
import { changesMade } from '../../../shared/firstFrame';

export default function Replay() {
  const navigate = useNavigate();

  const { poemHistory, setPoemHistory } = useContext(HistoryContext);
  const { text: htmlString, setText: setHtmlString } = useContext(TextContext);
  // The last frame, from the history as it is now (#356): once frozen at the first render.
  const maxStep = Math.max(poemHistory.length - 1, 0);
  const playPauseButton = useRef<HTMLButtonElement | null>(null);
  const draftsButton = useRef<HTMLButtonElement | null>(null);
  const refocusDrafts = useRef(false);
  const glide = useRef<Glide | null>(null);

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
  const follow = useFollowWriting(editor, poemHistory, step, glide);

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

  // Moving the slider (drag, click or key) pauses: the poet is choosing a frame, and stays on it (#237).
  // A Draft Marker's name, in Settings or on the timeline, jumps the same way.
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
  useEffect(() => {
    const removeOpen = window.electron.ipcRenderer.on(
      'open-file',
      (savedPoem, savedHistory) => {
        pause();
        setHtmlString(savedPoem);
        setPoemHistory(savedHistory);
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

  const closeDrafts = useCallback((fromList: boolean) => {
    setNaming(null);
    setDrawerOpen(false);
    refocusDrafts.current = fromList;
  }, []);
  const goToEdit = useCallback(() => navigate('/editor'), [navigate]);
  useReplayKeys(playPauseButton, closeDrafts, goToEdit);

  return (
    // The drafts list sits beside the poem and the timeline, never over them (#313, GitHub #85).
    <div
      className="ReplayLayout"
      style={{ backgroundColor: cssVar('background') }}
    >
      <div className="ReplayMain">
        <ReplayTopButtons
          fontSize={fontSize}
          following={follow.on}
          toggleFollowing={follow.toggle}
        />
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
            {/* Named like every other button here (#101): a screen reader said only "button". */}
            <ReasonButton
              label={playing ? i18n._('replay.pause') : i18n._('replay.play')}
              reason={playReason}
              reasonId="replay-play-reason"
              buttonRef={playPauseButton}
              spanClassName="control-icon-gap"
              className="control-bar-icon"
              style={{ color: cssVar('onControlBar') }}
              onClick={playing ? pause : play}
            >
              {playing ? (
                <PauseIcon fontSize="small" />
              ) : (
                <PlayArrowIcon fontSize="small" />
              )}
            </ReasonButton>
            <TimelineSlider
              poemHistory={poemHistory}
              maxStep={maxStep}
              step={step}
              onScrub={jumpTo}
              showTimestamp={showTimestamp.on}
              markers={drafts.markers}
              showMarkers={showMarkers}
              showLabels={showLabels}
              naming={timelineNaming}
              setNaming={setTimelineNaming}
              onJump={jumpTo}
              onLeaveNaming={leaveTimelineNaming}
              onRename={drafts.rename}
              onDelete={drafts.remove}
            />
            {/* Continue writing from here first, then the two Draft Marker buttons, then X (GitHub #90). */}
            <RestartFromButton step={step} pause={pause} />
            <ReasonButton
              label={i18n._('drafts.mark')}
              reason={draftReason}
              reasonId="replay-draft-reason"
              placement="top-end"
              classes={{ arrow: 'custom-arrow', tooltip: 'custom' }}
              className="control-bar-icon"
              style={{ color: cssVar('onControlBar') }}
              onClick={() => {
                pause();
                if (drafts.create(step)) setTimelineNaming(step);
              }}
              // A delete from the timeline offers no Undo here (GitHub #98): Annelyse asked for it to go.
              after={<RefusalAlert message={drafts.refusal} />}
            >
              <BookmarkAddIcon fontSize="small" />
            </ReasonButton>
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
        onJump={jumpTo}
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
