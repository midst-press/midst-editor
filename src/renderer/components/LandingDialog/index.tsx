import { useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { HistoryContext, TextContext } from 'renderer/context';
import { ChangeObj } from '@midst-press/midst-format/history';
import './LandingDialog.css';
import Logo from './LogoThin';
import FindNotHere, { FIND_BEFORE_OPEN } from '../../search/FindNotHere';

export default function LandingDialog() {
  const navigate = useNavigate();
  const { setText: setHtmlString } = useContext(TextContext);
  const { setPoemHistory } = useContext(HistoryContext);

  window.electron.titlebar.updateTitle('');

  const newFile = () => {
    window.electron.ipcRenderer.sendMessage('new-file', []);
  };

  const openFile = () => {
    window.electron.ipcRenderer.sendMessage('button-open-file', []);
  };

  // The main process opens the help in the poet's browser: the beta site for a beta (issue #105).
  const openHelp = () => {
    window.electron.ipcRenderer.sendMessage('open-help', []);
  };

  useEffect(() => {
    const removeOpen = window.electron.ipcRenderer.on(
      'open-file',
      (poem, history, filename) => {
        setHtmlString(poem as string);
        setPoemHistory(history as ChangeObj[]);
        window.electron.titlebar.updateTitle(filename as string);
        navigate('/editor');
      }
    );
    window.document.getElementById('svg')?.classList.add('hide');

    return () => {
      window.document.getElementById('svg')?.classList.remove('hide');

      removeOpen();
    };
    // All three are stable: navigate from the router, and the two setters are useState dispatchers
    // reached through context, whose identity React guarantees.
  }, [navigate, setHtmlString, setPoemHistory]);

  return (
    <div className="outer-container">
      <div className="message-container">
        <Logo />
        <h1 className="welcome-message">Welcome to Midst!</h1>
        <h2 className="welcome-message">Get Started:</h2>
        <div className="file-button-container">
          <button type="button" onClick={newFile}>
            New File...
          </button>
          <button type="button" onClick={openFile}>
            Open File...
          </button>
        </div>
        <button type="button" className="help-link" onClick={openHelp}>
          Need Help?
        </button>
      </div>
      <FindNotHere message={FIND_BEFORE_OPEN} />
    </div>
  );
}
