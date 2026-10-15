import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import HistoryIcon from '@mui/icons-material/History';
import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import { useTheme } from '@mui/material/styles';
import { Editor as EditorType } from '@tiptap/core';
import { EditorProvider } from '@tiptap/react';
import poemExtensions from 'shared/poemExtensions';
import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { fontSizeOrDefault } from 'main/fontSize';
import { Link, useNavigate } from 'react-router-dom';
import { TextContext, HistoryContext, RETURN_TO } from 'renderer/context';
import HandleTab from '../../HandleTab';
import RefusalAlert from '../DraftMarkers/RefusalAlert';
import useDraftMarkers, {
  UNAVAILABLE_STYLE,
} from '../DraftMarkers/useDraftMarkers';
import { ChangeObj, compareStrings } from '../../tracking/utils';
import FindBar, { FIND_BAR_CLASS } from '../../search/FindBar';
import SearchHighlight from '../../search/searchHighlight';
import './Editor.css';
import MenuBar from './MenuBar';
import useAutosave from './useAutosave';

const extensions = [...poemExtensions, HandleTab, SearchHighlight];

export default function Editor() {
  const [myEditor, setMyEditor] = useState<EditorType | null>(null);
  const theme = useTheme();
  const navigate = useNavigate();
  const [edited, setEdited] = useState<boolean>(false);

  // Read once: toggling it reloads the window, which reads it again.
  const [spellcheckOn] = useState<boolean>(
    () => window.electron.store.get('spellcheck') === 'true'
  );
  const heightClass = window.electron.versions.isMac
    ? 'editor-height-tall'
    : 'editor-height-short';

  const { text: htmlString, setText: setHtmlString } = useContext(TextContext);
  const { poemHistory, setPoemHistory } = useContext(HistoryContext);

  // THE DOCUMENT AS ONE VALUE, READABLE AT CALL TIME.
  //
  // `gen` identifies which document the text belongs to and advances on every open. Text, history and
  // identity are written together so they cannot be half-updated: #12 was exactly a case of the text
  // and the destination PATH coming from different places and disagreeing.
  //
  // It is also what makes `saveFileAndUpdateStore` identity-stable. Reading `htmlString` through a
  // parameter default closed over it, so memoising on those values would hand back a new identity on
  // every keystroke -- and the three effects react-hooks/exhaustive-deps wants the function added to
  // would then re-register once per character typed.
  const latest = useRef({ gen: 0, htmlString, poemHistory });
  // Declared ahead of every effect that saves, so the ref is current by the time those run.
  useEffect(() => {
    latest.current = { ...latest.current, htmlString, poemHistory };
  });

  // Explicit arguments still win, and the 'open-file' handler still passes them.
  // THE REF IS NOT A GUARD FOR #12. During an open it holds the document being REPLACED until the
  // handler updates it, so dropping those arguments would reinstate the overwrite exactly. What
  // protects that path is passing the document in; `gen` is the net underneath, not the fix.
  const saveFileAndUpdateStore = useCallback(
    (text?: string, history?: ChangeObj[]) => {
      const doc = latest.current;
      window.electron.store.set('poem', text ?? doc.htmlString);
      window.electron.store.set(
        'history',
        JSON.stringify(history ?? doc.poemHistory)
      );
      window.electron.ipcRenderer.sendMessage('save-file', []);
      setEdited(false);
    },
    []
  );
  const autosave = useAutosave(latest, saveFileAndUpdateStore);
  useEffect(() => {
    saveFileAndUpdateStore();
    const removeCancelSave = window.electron.ipcRenderer.on(
      'cancel-save',
      () => {
        navigate('/');
      }
    );
    window.electron.ipcRenderer.sendMessage('enable-save', []);
    return () => {
      removeCancelSave();
      window.electron.ipcRenderer.sendMessage('disable-save', []);
    };
  }, [navigate, saveFileAndUpdateStore]);

  const onUpdate = ({ editor }: { editor: EditorType }) => {
    const newHtml = editor.getHTML();
    const { pos } = editor.state.selection.$anchor;
    if (htmlString === newHtml) {
      return;
    }
    const newChange = compareStrings(htmlString, newHtml, pos);
    const newHistory = [...poemHistory, newChange];
    setPoemHistory(newHistory);
    setHtmlString(newHtml);
    if (edited === false) {
      setEdited(true);
      window.electron.store.set('edited', JSON.stringify(true));
    }

    autosave.schedule();
  };
  const onBlur = ({
    editor,
    event,
  }: {
    editor: EditorType;
    event: FocusEvent;
  }) => {
    // The find bar takes the focus on purpose; taking it back would leave the poet unable to type there.
    const to = event.relatedTarget;
    if (to instanceof Element && to.closest(`.${FIND_BAR_CLASS}`)) return;
    if (window.electron.versions.isMac) {
      editor.commands.focus();
    }
  };

  useEffect(() => {
    const removeOpen = window.electron.ipcRenderer.on(
      'open-file',
      (savedPoem, savedHistory, savedFilename) => {
        // Advance the generation so an autosave already in flight for the PREVIOUS document
        // abandons its write instead of sending that poem's text to this file's path, and point the
        // ref at the new document immediately rather than waiting for the re-render.
        latest.current = {
          gen: latest.current.gen + 1,
          htmlString: savedPoem as string,
          poemHistory: savedHistory as ChangeObj[],
        };
        setHtmlString(savedPoem as string);

        setPoemHistory(savedHistory as ChangeObj[]);
        window.electron.titlebar.updateTitle(savedFilename as string);
        if (myEditor) {
          myEditor.commands.setContent(savedPoem as string);
        }
        saveFileAndUpdateStore(
          savedPoem as string,
          savedHistory as ChangeObj[]
        );
        navigate('/editor');
      }
    );
    return removeOpen;
  }, [
    myEditor,
    navigate,
    saveFileAndUpdateStore,
    setHtmlString,
    setPoemHistory,
  ]);

  useEffect(() => {
    const removeToggleSpellcheck = window.electron.ipcRenderer.on(
      'toggle-spellcheck',
      () => {
        window.electron.store.set('spellcheck', (!spellcheckOn).toString());
        // The reloaded window takes its text from the store, and a pending autosave dies with this
        // page: save first, or the keystrokes of the last second are gone.
        saveFileAndUpdateStore();
        // The reload makes the whole text be checked again, and would otherwise leave the poet at
        // the opening screen instead of in their poem.
        window.sessionStorage.setItem(RETURN_TO, '/editor');
        window.location.reload();
      }
    );

    return removeToggleSpellcheck;
  }, [saveFileAndUpdateStore, spellcheckOn]);

  useEffect(() => {
    const removeToggleEdit = window.electron.ipcRenderer.on(
      'toggle-edit-mode',
      () => {
        saveFileAndUpdateStore();
        navigate('/replay');
      }
    );
    return () => {
      removeToggleEdit();
    };
  }, [navigate, saveFileAndUpdateStore]);

  // A draft marker made while writing marks the poem as it is now: the latest recorded change. The
  // text and history are stored with it, so the marker never points past what the file holds. The
  // poet is then taken to the replay to name it, as the original editor opened the name at once.
  const drafts = useDraftMarkers(poemHistory.length, saveFileAndUpdateStore);
  const latestMoment = poemHistory.length - 1;
  const draftReason = drafts.reasonAt(latestMoment);
  const markThisMoment = () => {
    autosave.cancel();
    if (drafts.create(latestMoment))
      navigate('/replay', { state: { nameDraftAt: latestMoment } });
  };

  const onCreate = ({ editor }: { editor: EditorType }) => {
    editor.commands.focus();
    setMyEditor(editor);
  };

  // The size the editor opens at. MenuBar changes the class on the editor itself after that.
  const [sizeClass] = useState(() =>
    fontSizeOrDefault(window.electron.store.get('font-size'))
  );

  return (
    <div
      style={{
        backgroundColor: theme.palette.background.default,
      }}
    >
      <EditorProvider
        slotBefore={<MenuBar />}
        extensions={extensions}
        content={htmlString}
        onUpdate={onUpdate}
        onBlur={onBlur}
        editorProps={{
          attributes: {
            class: `TextEditor ${heightClass} size-${sizeClass}`,
            spellcheck: spellcheckOn.toString(),
          },
        }}
        parseOptions={{ preserveWhitespace: true }}
        onCreate={onCreate}
      />
      <FindBar editor={myEditor} />

      <div className="Spacer">
        <Tooltip
          title={draftReason ?? 'Mark this moment as a draft'}
          TransitionComponent={Zoom}
          enterDelay={1000}
          arrow
          placement="top-start"
        >
          <span>
            <button
              aria-label="Mark this moment as a draft"
              aria-describedby={draftReason ? 'editor-draft-reason' : undefined}
              type="button"
              className="icon-button"
              style={draftReason ? UNAVAILABLE_STYLE : undefined}
              disabled={draftReason !== null}
              onClick={markThisMoment}
            >
              <BookmarkAddIcon fontSize="small" />
            </button>
            {draftReason && (
              <span id="editor-draft-reason" hidden>
                {draftReason}
              </span>
            )}
            <RefusalAlert message={drafts.refusal} />
          </span>
        </Tooltip>
        <Tooltip
          title="Replay"
          TransitionComponent={Zoom}
          enterDelay={1000}
          arrow
          placement="top-start"
        >
          {/* Saves first, as the menu's toggle-edit-mode does. Leaving the editor cancels a pending
              autosave, so without this the keystrokes of the last second are not in the file. */}
          <Link to="/replay" onClick={() => saveFileAndUpdateStore()}>
            <button aria-label="Replay" type="button" className="icon-button">
              <HistoryIcon fontSize="small" />
            </button>
          </Link>
        </Tooltip>
      </div>
    </div>
  );
}
