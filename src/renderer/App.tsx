import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Route, MemoryRouter as Router, Routes } from 'react-router-dom';
import './App.css';
import Editor from './components/Editor';
import LandingDialog from './components/LandingDialog';
import Replay from './components/Replay';
import themeObj from './theme';
import { TextContext, HistoryContext } from './context';
import { useState, useEffect } from 'react';
import { ChangeObj } from './tracking/utils';

const theme = createTheme(themeObj);

export default function App() {
  if (!window.electron)
    return (
      <>
        <CssBaseline />
        <ThemeProvider theme={theme}>Hello</ThemeProvider>
      </>
    );

  const restoreFilename =
    window.electron.store.get('baseFilename') || 'Untitled';
  window.electron.titlebar.updateTitle(restoreFilename);

  const restoreText = window.electron.store.get('poem') || '';
  const [text, setText] = useState(restoreText);
  const textContextValue = { text, setText };

  const restoreHistory = window.electron.store.get('history')
    ? JSON.parse(window.electron.store.get('history'))
    : [];
  const [poemHistory, setPoemHistory] = useState<ChangeObj[]>(restoreHistory);
  const historyContextValue = { poemHistory, setPoemHistory };
  useEffect(() => {
    const removeOpenFileHandler = window.electron.ipcRenderer.on(
      'open-file',
      (_savedText, savedHistory, savedFilename) => {
        const strHistory = savedHistory as ChangeObj[];
        setPoemHistory(strHistory);
        const savedFilenameStr = savedFilename as string;
        window.electron.titlebar.updateTitle(savedFilenameStr);
      }
    );
    const removeSetFilenameHandler = window.electron.ipcRenderer.on(
      'set-filename',
      (filepath) => {
        const filepathStr = filepath as string;
        window.electron.titlebar.updateTitle(filepathStr);
      }
    );

    return () => {
      removeOpenFileHandler();
      removeSetFilenameHandler();
    };
  }, []);

  return (
    <>
      <CssBaseline />
      <ThemeProvider theme={theme}>
        <TextContext.Provider value={textContextValue}>
          <HistoryContext.Provider value={historyContextValue}>
            <Router>
              <Routes>
                <Route path="/editor" element={<Editor />} />
                <Route path="/replay" element={<Replay />} />
                <Route path="/" element={<LandingDialog />} />
              </Routes>
            </Router>
          </HistoryContext.Provider>
        </TextContext.Provider>
      </ThemeProvider>
    </>
  );
}
