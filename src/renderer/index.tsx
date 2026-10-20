import { createRoot } from 'react-dom/client';
import App from './App';
import registerUncaughtErrorLogging from './uncaughtErrors';
import { startingLocale } from './locale';

registerUncaughtErrorLogging(window, window.electron.log);
// The words in the poet's language, read from the store as the main process reads it for the menus (editor #265).
startingLocale();

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(<App />);

// calling IPC exposed from preload script
window.electron.ipcRenderer.once('ipc-example', (arg) => {
  window.electron.log.debug('ipc-example reply', arg);
});
window.electron.ipcRenderer.sendMessage('ipc-example', ['ping']);
