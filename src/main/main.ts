/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
// First, before anything opens the store or the log: a development build keeps its own (Gitea #151).
import './devUserData';
import {
  attachTitlebarToWindow,
  setupTitlebar,
} from '@jshafto/custom-electron-titlebar-update/main';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainEvent,
  shell,
} from 'electron';
import debug from 'electron-debug';
import log from 'electron-log';
import path from 'path';
import {
  applyLogLevel,
  LOG_LEVEL_KEY,
  registerUncaughtHandlers,
} from './logging';
import MenuBuilder, {
  applyStoredAppearance,
  isDevelopment,
  save,
  newFile,
  openFile,
  openPath,
  logIfRejected,
} from './menu';
import store from './store';
import { flushEditor, setEditorShowing } from './editorFlush';
import { helpUrl } from '../shared/helpUrl';
import { logFileForPeople } from './logFile';
import { resolveHtmlPath } from './util';
import { describeError } from '../shared/errorSummary';
import { activateLocale, i18n, pickLocale } from '../shared/i18n';
import { LOCALE_ARGUMENT } from '../shared/localeArgument';

let mainWindow: BrowserWindow | null = null;

setupTitlebar();

let earlyPath = '';
// Whether the current window has been shown. Until then, ready-to-show is what opens a requested file.
let windowShown = false;

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  log.debug(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug = isDevelopment();
const isDarwin = () => process.platform === 'darwin';

if (isDebug) {
  debug();
}

const installExtensions = async () => {
  const {
    default: installExtension,
    // REDUX_DEVTOOLS,
    REACT_DEVELOPER_TOOLS,
  } = await import('electron-devtools-assembler');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = [REACT_DEVELOPER_TOOLS];

  return installExtension(extensions, {
    loadExtensionOptions: { allowFileAccess: true },
    forceDownload,
  }).catch((err) => log.warn('failed to install devtools extension', err));
};

// The document the window held, removed from the store when the window closes.
const clearDocument = () => {
  ['filename', 'baseFilename', 'poem', 'history', 'meta'].forEach((key) =>
    store.delete(key)
  );
  store.set('edited', 'false');
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  applyStoredAppearance();

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    frame: false,
    // Linux cannot use an .ico for a window icon, so the window had none there (#32). macOS
    // ignores this option and takes the icon from the app bundle.
    icon:
      process.platform === 'linux'
        ? getAssetPath('icons', '256x256.png')
        : getAssetPath('icon.ico'),
    webPreferences: {
      sandbox: false,
      // The renderer shows its words in the language the menus use, chosen at whenReady.
      additionalArguments: [`${LOCALE_ARGUMENT}${i18n.locale}`],
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: true,
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  // A page with no title of its own (the opening screen's is empty, #194) leaves Electron to name the window after
  // the page's file, index.html, which the Window menu, Mission Control and the Dock show. It is called Midst there.
  mainWindow.on('page-title-updated', (event, title, explicitSet) => {
    if (explicitSet && title !== '') return;
    event.preventDefault();
    mainWindow?.setTitle(i18n._('menu.app'));
  });

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }

    if (earlyPath !== '') {
      openPath(mainWindow, isDarwin(), earlyPath);
      earlyPath = '';
    }
    windowShown = true;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    windowShown = false;
  });
  // Closing asks the editor for the poem first, as Save does (#157), and only then reads `edited` (#236). Quit,
  // Close and Save are menu items, run in this process, while a keystroke reaches the editor first and `edited`
  // follows it here by message. So a quit straight after typing found `edited` still "false" from the last save,
  // closed without asking, and lost those keystrokes, and so did Save then Quit, closing before the save had the
  // poem. The editor's answer comes after the messages it sent before it, so `edited` is current once it arrives.
  //   - The close is held while the editor answers (at most FLUSH_TIMEOUT_MS, then `edited` as it stands), and
  //     a second close in that time waits for the first.
  //   - Saved: the document is cleared and the window destroyed. Unsaved: the poet is asked, as before.
  let closeChecking = false;
  mainWindow.on('close', (event) => {
    event.preventDefault();
    if (closeChecking || mainWindow === null) return;
    closeChecking = true;
    const win = mainWindow;
    const decide = async () => {
      try {
        await flushEditor(win);
        if (win.isDestroyed()) return;
        if (store.get('edited') === 'false') {
          clearDocument();
          win.destroy();
          return;
        }
        const choice = dialog.showMessageBoxSync(win, {
          type: 'warning',
          title: i18n._('dialog.unsavedChanges.title'),
          message: i18n._('dialog.unsavedChanges.message'),
          buttons: [
            i18n._('dialog.unsavedChanges.quitAnyway'),
            i18n._('button.cancel'),
          ],
          // Return keeps the work: the default button is Cancel, never the one that discards (#40).
          defaultId: 1,
          // Dismissing the message box is Cancel too.
          cancelId: 1,
        });
        if (choice === 0) {
          // "Quit Anyway": the document is removed from the store and the window closed.
          clearDocument();
          win.destroy();
        }
      } finally {
        closeChecking = false;
      }
    };
    decide().catch((err) =>
      log.error(
        'close: the check for unsaved changes failed',
        describeError(err)
      )
    );
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();
  attachTitlebarToWindow(mainWindow);

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // The log level is whatever the user has configured; see src/main/logging.ts. (There is no update
  // check: removed until self-update can ask first, #178, #269.)
  applyLogLevel();
};

// The renderer's requests. Registered once, here: createWindow runs again on activate, and while
// these were registered inside it each new window added another handler, so one save-file saved
// twice.
ipcMain.on('save-file', () => {
  if (mainWindow === null) return;
  // One of the editor's own saves, not the poet choosing Save: a failure is reported once per file.
  const win = mainWindow;
  logIfRejected('autosave', () => save(win, isDarwin(), false));
});
ipcMain.on('new-file', () => {
  if (mainWindow === null) return;
  const win = mainWindow;
  logIfRejected('new', () => newFile(win, isDarwin()));
});
ipcMain.on('button-open-file', () => {
  if (mainWindow === null) return;
  const win = mainWindow;
  logIfRejected('open', () => openFile(win, isDarwin()));
});

// "Need Help?" on the opening screen. Main decides where it goes, from the app's own version.
ipcMain.on('open-help', () => {
  logIfRejected('help', () => shell.openExternal(helpUrl(app.getVersion())));
});

ipcMain.on('app-open', (filename: IpcMainEvent) => {
  // The open/save pairing is where a document was once written to another document's path
  // (#12), so which file the OS asked us to open is worth having in the log.
  log.info('os requested open', { filename });
  if (mainWindow === null) return;
  const win = mainWindow;
  logIfRejected('os open', () =>
    openFile(win, isDarwin(), filename as unknown as string[])
  );
});

// Save and Save As are enabled only while the editor is showing.
const setSaveEnabled = (enabled: boolean) => {
  if (mainWindow === null) return;
  ['menu.file.save', 'menu.file.saveAs'].forEach((id) => {
    const item = app.applicationMenu?.getMenuItemById(id);
    if (item) item.enabled = enabled;
  });
};
ipcMain.on('enable-save', () => {
  setEditorShowing(true);
  setSaveEnabled(true);
});
ipcMain.on('disable-save', () => {
  setEditorShowing(false);
  setSaveEnabled(false);
});

// IPC listener
ipcMain.on('electron-store-get', async (event, val) => {
  event.returnValue = store.get(val);
});
ipcMain.on('electron-store-set', async (event, key, val) => {
  store.set(key, val);
  // Applied immediately so raising the level takes effect inside the session being reproduced,
  // rather than only after a restart.
  if (key === LOG_LEVEL_KEY) {
    log.info('log level changed', { level: applyLogLevel(val) });
  }
});

// Errors nothing caught are logged (name and frames only) and the poet is told; the app keeps running.
registerUncaughtHandlers(process, (name) =>
  dialog.showErrorBox(
    i18n._('dialog.unexpectedError.title'),
    i18n._('dialog.unexpectedError.message', {
      name,
      logFile: logFileForPeople(),
    })
  )
);

// Renderer diagnostics, forwarded from the preload's window.electron.log. The level is matched
// explicitly rather than by indexing `log` with a string off the wire. They are written through
// the 'renderer' scope, which the file format records as "source":"renderer".
const rendererLog = log.scope('renderer');
ipcMain.on(
  'log-message',
  (_event, level: string, message: string, meta?: unknown) => {
    // An if-chain rather than a lookup table: a table needs a function TYPE annotation, whose
    // mandatory parameter names the base no-unused-vars rule misreads as unused bindings. This
    // keeps `log` from ever being indexed by a string off the wire, with no rule turned off.
    if (level === 'error') {
      if (meta === undefined) rendererLog.error(message);
      else rendererLog.error(message, meta);
    } else if (level === 'warn') {
      if (meta === undefined) rendererLog.warn(message);
      else rendererLog.warn(message, meta);
    } else if (level === 'debug') {
      if (meta === undefined) rendererLog.debug(message);
      else rendererLog.debug(message, meta);
    } else if (meta === undefined) rendererLog.info(message);
    else rendererLog.info(message, meta);
  }
);

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Uncomment to respect the OSX convention of having the application in memory even
  // after all windows have been closed
  // if (process.platform !== 'darwin') {
  //   app.quit();
  // }
  app.quit();
});

// Responding to external requests to open a file
app.on('open-file', async (event, filename) => {
  // this event fires on mac before the main window exists
  // store the filename, so it can be used once the window is ready
  // on other operating systems, this will need to be handled differently
  event.preventDefault();
  // Held for ready-to-show only while no window has been shown. Once one has, app-open opens the file (with
  // the unsaved-changes prompt) and nothing is held: a path left here was read straight into the next
  // window, without the prompt, after the poet closed this one and reopened from the Dock (#41).
  if (!windowShown) earlyPath = filename;
  ipcMain.emit('app-open', [filename]);
});

app
  .whenReady()
  .then(() => {
    // The menus, dialogs and window speak the system's first language the catalog has, else English
    // (midst-infra docs/design/message-catalog.md, section 6). Chosen once, before the first window.
    activateLocale(pickLocale(app.getPreferredSystemLanguages()));
    createWindow();
    app.on('activate', (_event, hasVisibleWindows) => {
      if (!hasVisibleWindows) {
        createWindow();
      }
    });
  })
  .catch((err) => log.error('app failed to become ready', err));
