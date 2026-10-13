import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import HistoryIcon from '@mui/icons-material/History';
import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import { useTheme } from '@mui/material/styles';
import { Editor as EditorType } from '@tiptap/core';
import { EditorProvider } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { fontSizeFromStore } from 'main/fontSize';
import { Link, useNavigate } from 'react-router-dom';
import { TextContext, HistoryContext } from 'renderer/context';
import HandleTab from '../../HandleTab';
import useDraftMarkers from '../DraftMarkers/useDraftMarkers';
import { ChangeObj, compareStrings } from '../../tracking/utils';
import './Editor.css';
import MenuBar from './MenuBar';

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
  HandleTab,
];

export default function Editor() {
  const [myEditor, setMyEditor] = useState<EditorType | null>(null);
  const theme = useTheme();
  const navigate = useNavigate();
  const [edited, setEdited] = useState<Boolean>(false);

  const [autosaveTimeout, setAutostateTimeout] = useState<
    NodeJS.Timeout | number | undefined
  >(undefined); // create interval for autosaving

  const restoreSpellcheckSetting = window.electron.store.get('spellcheck');
  const [spellcheckOn, setSpellcheckOn] = useState<boolean>(
    restoreSpellcheckSetting === 'true'
  );
  const heightClass = window.electron.versions.isMac
    ? 'editor-height-tall'
    : 'editor-height-short';

  // const { filename, setFilename } = useContext(FilenameContext);
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

    // Cancel the pending autosave and schedule a new one. The generation captured here identifies
    // the document being typed into: if an open lands before the timer fires, `gen` has moved on and
    // the write is abandoned rather than carrying this poem's text to the newly opened file's path.
    // There is no lock and nothing to release, so this cannot wedge saving -- the worst case is a
    // write that proceeds, which is the behaviour without the check.
    clearTimeout(autosaveTimeout);
    const genAtSchedule = latest.current.gen;
    const newTimeout = setTimeout(() => {
      if (latest.current.gen !== genAtSchedule) {
        window.electron.log.warn(
          'autosave abandoned: the document changed after the save was scheduled'
        );
        return;
      }
      // No arguments, so the ref supplies the document as it stands when the timer fires. Passing
      // the function straight to setTimeout saved the text from BEFORE the last keystroke.
      saveFileAndUpdateStore();
    }, 1000);
    setAutostateTimeout(newTimeout);
  };
  const onBlur = ({ editor }: { editor: EditorType }) => {
    if (window.electron.versions.isMac) {
      editor.commands.focus();
    }
  };

  useEffect(() => {
    const removeCancelSave = window.electron.ipcRenderer.on(
      'cancel-save',
      () => {
        navigate('/');
      }
    );
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

    const removeToggleSpellcheckHandler = window.electron.ipcRenderer.on(
      'toggle-spellcheck',
      () => {
        setSpellcheckOn(!spellcheckOn);
        window.electron.store.set('spellcheck', (!spellcheckOn).toString());
        window.location.reload();
      }
    );

    return () => {
      removeCancelSave();
      removeOpen();
      removeToggleSpellcheckHandler();
    };
  }, [
    myEditor,
    navigate,
    saveFileAndUpdateStore,
    setHtmlString,
    setPoemHistory,
    spellcheckOn,
  ]);

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
      clearTimeout(autosaveTimeout);
    };
  }, [autosaveTimeout, navigate, saveFileAndUpdateStore]);

  // A draft marker made while writing marks the poem as it is now: the latest recorded change. The
  // text and history are stored with it, so the marker never points past what the file holds. The
  // poet is then taken to the replay to name it, as the original editor opened the name at once.
  const drafts = useDraftMarkers(poemHistory.length, saveFileAndUpdateStore);
  const latestMoment = poemHistory.length - 1;
  const markThisMoment = () => {
    clearTimeout(autosaveTimeout);
    if (drafts.create(latestMoment))
      navigate('/replay', { state: { nameDraftAt: latestMoment } });
  };

  const onCreate = ({ editor }: { editor: EditorType }) => {
    editor.commands.focus();
    setMyEditor(editor);
  };

  const restoreSizeClassSetting = fontSizeFromStore(
    window.electron.store.get('font-size')
  );

  const [sizeClass] = useState<number>(
    [0, 1, 2, 3, 4].includes(restoreSizeClassSetting)
      ? restoreSizeClassSetting
      : 2
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

      <div className="Spacer">
        <Tooltip
          title="Mark this moment as a draft"
          TransitionComponent={Zoom}
          enterDelay={1000}
          arrow
          placement="top-start"
        >
          <span>
            <button
              aria-label="Mark this moment as a draft"
              type="button"
              className="icon-button"
              disabled={!drafts.canCreateAt(latestMoment)}
              onClick={markThisMoment}
            >
              <BookmarkAddIcon fontSize="small" />
            </button>
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
