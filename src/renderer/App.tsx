import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Route, MemoryRouter as Router, Routes } from 'react-router-dom';
import './cssVars.css';
import './App.css';
import { useState, useEffect, useMemo } from 'react';
import Editor from './components/Editor';
import LandingDialog from './components/LandingDialog';
import Replay from './components/Replay';
import themeObj from './theme';
import { TextContext, HistoryContext, RETURN_TO } from './context';
import { ChangeObj } from './tracking/utils';

const theme = createTheme(themeObj);

export default function App() {
  // Every hook must run before the `window.electron` guard below. The preload script injects
  // window.electron, so when it fails to load this component previously returned early and called
  // ZERO hooks, while a healthy launch called three -- react-hooks/rules-of-hooks. Optional chaining
  // covers the degraded case so the hook order is identical either way.
  const restoreText = window.electron?.store.get('poem') || '';
  // After a reload the router would start at the opening screen again. If the editor asked to come
  // back (it does before reloading for the spellcheck toggle), start there instead, once.
  const [startAt] = useState(() => {
    const returnTo = window.sessionStorage.getItem(RETURN_TO);
    window.sessionStorage.removeItem(RETURN_TO);
    return returnTo === '/editor' ? returnTo : '/';
  });
  const [text, setText] = useState(restoreText);
  // Memoised so context consumers do not re-render on every App render.
  const textContextValue = useMemo(() => ({ text, setText }), [text]);

  const storedHistory = window.electron?.store.get('history');
  const [poemHistory, setPoemHistory] = useState<ChangeObj[]>(
    storedHistory ? JSON.parse(storedHistory) : []
  );
  const historyContextValue = useMemo(
    () => ({ poemHistory, setPoemHistory }),
    [poemHistory]
  );
  useEffect(() => {
    if (!window.electron) {
      return undefined;
    }
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

  return (
    <>
      <CssBaseline />
      <ThemeProvider theme={theme}>
        <TextContext.Provider value={textContextValue}>
          <HistoryContext.Provider value={historyContextValue}>
            <Router initialEntries={[startAt]}>
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
