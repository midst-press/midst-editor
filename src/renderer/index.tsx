import { createRoot } from 'react-dom/client';
import App from './App';
import registerUncaughtErrorLogging from './uncaughtErrors';
import { activateLocale } from '../shared/i18n';

registerUncaughtErrorLogging(window, window.electron.log);
// The words in the language the main process chose for the menus (midst-infra docs/design/message-catalog.md).
activateLocale(window.electron.locale);

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(<App />);

// calling IPC exposed from preload script
window.electron.ipcRenderer.once('ipc-example', (arg) => {
  window.electron.log.debug('ipc-example reply', arg);
});
window.electron.ipcRenderer.sendMessage('ipc-example', ['ping']);
