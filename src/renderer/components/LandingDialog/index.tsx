import { useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { HistoryContext, TextContext } from 'renderer/context';
import { ChangeObj } from 'renderer/tracking/utils';
import './LandingDialog.css';
import Logo from './LogoThin';
import { Link } from 'react-router-dom';

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
  }, []);

  return (
    <div className="outer-container">
      <div className="message-container">
        <Logo></Logo>
        <h1 className="welcome-message">Welcome to Midst!</h1>
        <h2 className="welcome-message">Get Started:</h2>
        <div className="file-button-container">
          <button onClick={newFile}>New File...</button>
          <button onClick={openFile}>Open File...</button>
        </div>
        <Link className="help-link" target="_blank" to="https://midst.press">
          Need Help?
        </Link>
      </div>
    </div>
  );
}
