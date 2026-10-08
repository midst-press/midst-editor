import HistoryIcon from '@mui/icons-material/History';
import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import { useTheme } from '@mui/material/styles';
import { Editor as EditorType } from '@tiptap/core';
import { EditorProvider } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useState, useEffect, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HandleTab } from '../../HandleTab';
import { ChangeObj, compareStrings } from '../../tracking/utils';
import './Editor.css';
import MenuBar from './MenuBar';
import { TextContext, HistoryContext } from 'renderer/context';

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

  const saveFileAndUpdateStore = () => {
    console.log('saveFileAndUpdateStore');
    window.electron.store.set('poem', htmlString);
    window.electron.store.set('history', JSON.stringify(poemHistory));
    window.electron.ipcRenderer.sendMessage('save-file', []);
    setEdited(false);
  };
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
  }, []);

  // const { filename, setFilename } = useContext(FilenameContext);
  const { text: htmlString, setText: setHtmlString } = useContext(TextContext);
  const { poemHistory, setPoemHistory } = useContext(HistoryContext);
  const onUpdate = ({ editor }: { editor: EditorType }) => {
    const newHtml = editor.getHTML();
    const pos = editor.state.selection.$anchor.pos;
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

    // cancel current autosave interval and set new one
    clearTimeout(autosaveTimeout);
    const newTimeout = setTimeout(saveFileAndUpdateStore, 1000);
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
        setHtmlString(savedPoem as string);

        setPoemHistory(savedHistory as ChangeObj[]);
        window.electron.titlebar.updateTitle(savedFilename as string);
        if (myEditor) {
          myEditor.commands.setContent(savedPoem as string);
        }
        saveFileAndUpdateStore();
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
  }, [myEditor]);

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
  }, [htmlString, poemHistory, autosaveTimeout]);

  const onCreate = ({ editor }: { editor: EditorType }) => {
    editor.commands.focus();
    setMyEditor(editor);
  };

  const restoreSizeClassSetting = window.electron.store.get('font-size')
    ? Number(window.electron.store.get('font-size'))
    : 2;

  const [sizeClass, _setSizeClass] = useState<number>(
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
      >
        <></>
      </EditorProvider>

      <div className="Spacer">
        <Tooltip
          title="Replay"
          TransitionComponent={Zoom}
          enterDelay={1000}
          arrow
          placement="top-start"
        >
          <Link to="/replay">
            <button type="button" className="icon-button">
              <HistoryIcon fontSize="small" />
            </button>
          </Link>
        </Tooltip>
      </div>
    </div>
  );
}
