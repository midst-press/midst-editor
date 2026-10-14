import './Replay.css';
import { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { reconstructHTML, ChangeObj } from 'renderer/tracking/utils';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import BookmarksIcon from '@mui/icons-material/Bookmarks';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import { format } from 'date-fns';
import Grow from '@mui/material/Grow';
import Box from '@mui/material/Box';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextIncreaseIcon from '@mui/icons-material/TextIncrease';
import TextDecreaseIcon from '@mui/icons-material/TextDecrease';
import { HistoryContext, TextContext } from 'renderer/context';
import { fontSizeFromStore } from 'main/fontSize';
import DraftDrawer from '../DraftMarkers/DraftDrawer';
import useDraftMarkers from '../DraftMarkers/useDraftMarkers';
import { scrollParent, targetScrollTop, glideTo, Glide } from './follow';
import usePlayback from './usePlayback';

const extensions = [
  StarterKit.configure({
    bulletList: false,
    orderedList: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    strike: false,
  }),
];

export default function Replay() {
  const theme = useTheme();
  const navigate = useNavigate();

  const { poemHistory, setPoemHistory } = useContext(HistoryContext);
  const { text: htmlString, setText: setHtmlString } = useContext(TextContext);
  const [maxStep] = useState(poemHistory.length ? poemHistory.length - 1 : 0);
  const playPauseButton = useRef<HTMLButtonElement | null>(null);
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
  const drafts = useDraftMarkers(poemHistory.length, saveDocument);
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

  const restoreSizeClassSetting = fontSizeFromStore(
    window.electron.store.get('font-size')
  );

  const [sizeClass, setSizeClass] = useState<number>(
    [0, 1, 2, 3, 4].includes(restoreSizeClassSetting)
      ? restoreSizeClassSetting
      : 2
  );

  const editor = useEditor({
    extensions,
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
    if (changed != null && scroller) {
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
      (savedPoem, savedHistory, savedFilename) => {
        pause();
        setHtmlString(savedPoem as string);
        setPoemHistory(savedHistory as ChangeObj[]);
        window.electron.titlebar.updateTitle(savedFilename as string);
        navigate('/editor');
      }
    );

    const removeToggleEditHandler = window.electron.ipcRenderer.on(
      'toggle-edit-mode',
      () => {
        navigate('/editor');
      }
    );

    const removeFontSizeHandler = window.electron.ipcRenderer.on(
      'set-font-size',
      (newSize) => {
        setSizeClass(Number(newSize));
      }
    );

    return () => {
      removeOpen();
      removeToggleEditHandler();
      removeFontSizeHandler();
    };
  }, [navigate, setHtmlString, setPoemHistory, pause]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // While the drafts list is open, the keys belong to it and not to playback: Space and Enter
      // would start the poem playing behind the list, and Escape is the list's own way to close.
      // Focus sits on the drawer's panel when it opens, so this asks the drawer, not the focused element.
      if (document.querySelector('.DraftDrawer')) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea'))
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
  const decreaseSize = () => {
    if (sizeClass <= 0) {
      return;
    }
    window.electron.store.set('font-size', String(sizeClass - 1));

    setSizeClass(sizeClass - 1);
  };
  const increaseSize = () => {
    if (sizeClass >= 4) {
      return;
    }

    window.electron.store.set('font-size', String(sizeClass + 1));
    setSizeClass(sizeClass + 1);
  };

  return (
    <div style={{ backgroundColor: theme.palette.background.default }}>
      <div className="TopButtons">
        <Tooltip
          title="Increase text size"
          TransitionComponent={Zoom}
          enterDelay={1000}
          arrow
        >
          <button
            aria-label="Increase text size"
            type="button"
            onClick={increaseSize}
            disabled={sizeClass >= 4}
            className="icon-button size-icon"
          >
            <TextIncreaseIcon fontSize="small" />
          </button>
        </Tooltip>
        <Tooltip
          title="Decrease text size"
          TransitionComponent={Zoom}
          enterDelay={1000}
          arrow
        >
          <button
            aria-label="Decrease text size"
            type="button"
            disabled={sizeClass <= 0}
            className="icon-button size-icon"
            onClick={decreaseSize}
          >
            <TextDecreaseIcon fontSize="small" />
          </button>
        </Tooltip>
      </div>
      <div className={`ReplayContainer size-${sizeClass}`}>
        <EditorContent editor={editor} />
      </div>
      <Grow mountOnEnter in>
        <Box
          component="div"
          className="ControlBar"
          style={{
            backgroundColor: theme.palette.primary.dark,
          }}
        >
          <button
            type="button"
            ref={playPauseButton}
            style={{ color: theme.palette.secondary.contrastText }}
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
              color: theme.palette.secondary.contrastText,
              marginRight: '15px',
              cursor: poemHistory.length ? undefined : 'not-allowed',
              // Draft markers: a tick tall enough to see on the rail, and the name above the bar,
              // where there is room for it.
              '& .MuiSlider-mark': {
                height: '14px',
                width: '2px',
                backgroundColor: theme.palette.text.primary,
                opacity: 0.7,
              },
              '& .MuiSlider-markLabel': {
                top: '-34px',
                fontSize: '0.75rem',
                color: theme.palette.text.primary,
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
            title="Mark this moment as a draft"
            TransitionComponent={Zoom}
            enterDelay={1000}
            arrow
            placement="top-end"
            classes={{ arrow: 'custom-arrow', tooltip: 'custom' }}
          >
            <span>
              <button
                aria-label="Mark this moment as a draft"
                type="button"
                className="control-bar-icon"
                style={{ color: theme.palette.secondary.contrastText }}
                disabled={!drafts.canCreateAt(step)}
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
            </span>
          </Tooltip>
          <Tooltip
            title="Drafts"
            TransitionComponent={Zoom}
            enterDelay={1000}
            arrow
            placement="top-end"
            classes={{ arrow: 'custom-arrow', tooltip: 'custom' }}
          >
            <button
              aria-label="Drafts"
              type="button"
              className="control-bar-icon"
              style={{ color: theme.palette.secondary.contrastText }}
              onClick={() => setDrawerOpen(true)}
            >
              <BookmarksIcon fontSize="small" />
            </button>
          </Tooltip>
          <Tooltip
            title="Edit"
            TransitionComponent={Zoom}
            enterDelay={1000}
            arrow
            placement="top-end"
            classes={{ arrow: 'custom-arrow', tooltip: 'custom' }}
          >
            <Link to="/editor">
              <button
                aria-label="Edit"
                type="button"
                className="control-bar-icon"
                style={{
                  color: theme.palette.secondary.contrastText,
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
        showMarkers={showMarkers}
        setShowMarkers={setShowMarkers}
        showLabels={showLabels}
        setShowLabels={setShowLabels}
      />
    </div>
  );
}
