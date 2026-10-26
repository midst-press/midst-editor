import CssBaseline from '@mui/material/CssBaseline';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Route, MemoryRouter as Router, Routes } from 'react-router-dom';
import './cssVars.css';
import './App.css';
import { useState, useEffect, useMemo } from 'react';
import { ChangeObj } from '@midst-press/midst-format/history';
import Editor from './components/Editor';
import LandingDialog from './components/LandingDialog';
import Replay from './components/Replay';
import WindowTitle from './WindowTitle';
import themeObj, { darkThemeObj } from './theme';
import { TextContext, HistoryContext, RETURN_TO } from './context';
import { LocaleContext, useMenuLocale } from './locale';

const lightTheme = createTheme(themeObj);
const darkTheme = createTheme(darkThemeObj);

// The MUI theme of the scheme in force: the View > Appearance choice, or the OS's when the poet has made
// none (GitHub #16). The main process turns that choice into prefers-color-scheme, which cssVars.css also
// follows.
export const useSchemeTheme = () =>
  useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true })
    ? darkTheme
    : lightTheme;

export default function App() {
  // Every hook must run before the `window.electron` guard below. The preload script injects
  // window.electron, so when it fails to load this component previously returned early and called
  // ZERO hooks, while a healthy launch called three -- react-hooks/rules-of-hooks. Optional chaining
  // covers the degraded case so the hook order is identical either way.
  const theme = useSchemeTheme();
  const locale = useMenuLocale();
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
  // The open poem's file name, for the window title (#125): from the store at launch or after a reload,
  // then from whichever message names it.
  const [filename, setFilename] = useState<string>(
    () => window.electron?.store.get('baseFilename') || ''
  );
  // After a save failed, the title says the poem is not saved until a save works, on every platform (#94; GitHub #75).
  const [notSaved, setNotSaved] = useState(false);
  useEffect(() => {
    if (!window.electron) {
      return undefined;
    }
    const removeOpenFileHandler = window.electron.ipcRenderer.on(
      'open-file',
      (_savedText, savedHistory, savedFilename) => {
        const strHistory = savedHistory as ChangeObj[];
        setPoemHistory(strHistory);
        setFilename(savedFilename as string);
        setNotSaved(false);
      }
    );
    const removeSetFilenameHandler = window.electron.ipcRenderer.on(
      'set-filename',
      (filepath) => {
        setFilename(filepath as string);
      }
    );

    const removeSetNotSavedHandler = window.electron.ipcRenderer.on(
      'set-not-saved',
      (shown) => {
        setNotSaved(shown === true);
      }
    );

    return () => {
      removeOpenFileHandler();
      removeSetFilenameHandler();
      removeSetNotSavedHandler();
    };
  }, []);

  if (!window.electron)
    return (
      <>
        <CssBaseline />
        {/* Outside Electron (a browser on the dev server), with no preload: never what a poet sees. */}
        {/* eslint-disable-next-line lingui/no-unlocalized-strings */}
        <ThemeProvider theme={theme}>Hello</ThemeProvider>
      </>
    );

  return (
    <>
      <CssBaseline />
      <ThemeProvider theme={theme}>
        <LocaleContext.Provider value={locale}>
          <TextContext.Provider value={textContextValue}>
            <HistoryContext.Provider value={historyContextValue}>
              <Router initialEntries={[startAt]}>
                <WindowTitle filename={filename} notSaved={notSaved} />
                <Routes>
                  <Route path="/editor" element={<Editor />} />
                  <Route path="/replay" element={<Replay />} />
                  <Route path="/" element={<LandingDialog />} />
                </Routes>
              </Router>
            </HistoryContext.Provider>
          </TextContext.Provider>
        </LocaleContext.Provider>
      </ThemeProvider>
    </>
  );
}
