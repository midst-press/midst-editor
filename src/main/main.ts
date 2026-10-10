/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
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
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import fs from 'fs';
import path from 'path';
import { applyLogLevel, LOG_LEVEL_KEY } from './logging';
import MenuBuilder, { save, newFile, openFile } from './menu';
import store from './store';
import { writeConvertedFile } from './convertedFile';
import {
  fileVersionMatchesCurrent,
  convertMidstFile,
  includeVersionInfo,
  loadDataIntoWorkspace,
  resolveHtmlPath,
} from './util';

class AppUpdater {
  constructor() {
    // Level is whatever the user has configured; see src/main/logging.ts.
    applyLogLevel();
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

setupTitlebar();

let earlyPath = '';

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  log.debug(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')();
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

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

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
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: true,
  });

  ipcMain.on('save-file', async () => {
    const darwin = process.platform === 'darwin';
    if (mainWindow === null) return;
    save(mainWindow, darwin);
  });
  ipcMain.on('new-file', async () => {
    const darwin = process.platform === 'darwin';
    if (mainWindow === null) return;
    newFile(mainWindow, darwin);
  });
  ipcMain.on('button-open-file', async () => {
    const darwin = process.platform === 'darwin';
    if (mainWindow === null) return;
    openFile(mainWindow, darwin);
  });

  ipcMain.on('app-open', (filename: IpcMainEvent) => {
    const darwin = process.platform === 'darwin';
    // The open/save pairing is where a document was once written to another document's path
    // (#12), so which file the OS asked us to open is worth having in the log.
    log.info('os requested open', { filename });
    if (mainWindow === null) return;
    openFile(mainWindow, darwin, filename as unknown as string[]);
  });

  ipcMain.on('enable-save', async () => {
    if (mainWindow === null) return;
    const saveMenuItem = app.applicationMenu?.getMenuItemById('save');
    if (saveMenuItem) {
      saveMenuItem.enabled = true;
    }
    const saveAsMenuItem = app.applicationMenu?.getMenuItemById('save-as');
    if (saveAsMenuItem) {
      saveAsMenuItem.enabled = true;
    }
  });

  ipcMain.on('disable-save', async () => {
    if (mainWindow === null) return;
    const saveMenuItem = app.applicationMenu?.getMenuItemById('save');
    if (saveMenuItem) {
      saveMenuItem.enabled = false;
    }
    const saveAsMenuItem = app.applicationMenu?.getMenuItemById('save-as');
    if (saveAsMenuItem) {
      saveAsMenuItem.enabled = false;
    }
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }

    const darwin = process.platform === 'darwin';
    if (earlyPath !== '') {
      fs.readFile(earlyPath, 'utf8', (_err, data) => {
        if (fileVersionMatchesCurrent(data)) {
          try {
            if (mainWindow === null) return;
            loadDataIntoWorkspace(earlyPath, data, mainWindow, darwin);
          } catch {
            if (mainWindow === null) return;
            dialog.showMessageBoxSync(mainWindow, {
              title: `Error`,
              type: 'error',
              message: `The file ${earlyPath} could not be opened. File may be corrupted. Please select another file and try again.`,
            });
          }
          earlyPath = '';
        } else {
          if (mainWindow === null) return;
          const response = dialog.showMessageBoxSync(mainWindow, {
            type: 'warning',
            message: `Version not recognized. If this file is from an
             older version of Midst, it may be possible to convert it.
             This will create a new file. Would you like to proceed?`,
            buttons: ['Cancel', 'Convert File'],
            defaultId: 1,
            cancelId: 0,
          });
          if (response === 1) {
            const newFileContents = convertMidstFile(data);
            const newFilename = writeConvertedFile(
              earlyPath,
              includeVersionInfo(newFileContents)
            );
            loadDataIntoWorkspace(
              newFilename,
              includeVersionInfo(newFileContents),
              mainWindow,
              darwin
            );
          }
          earlyPath = '';
        }
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('close', (event) => {
    const clearableStoreKeys = ['filename', 'baseFilename', 'poem', 'history'];
    if (store.get('edited') === 'false') {
      clearableStoreKeys.forEach((keyName) => {
        store.delete(keyName);
      });
      store.set('edited', 'false');
      return;
    }

    // If the window has unsaved changes, prevents it from closing
    event.preventDefault();

    if (mainWindow === null) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'Unsaved changes',
      message:
        'Current document contains unsaved changes. Are you sure you want to proceed?',
      buttons: ['Quit Anyway', 'Cancel'],
      // Sets the first option as the default option
      // if the user hits the Return key
      defaultId: 0,
      // Sets the second button as the button selected
      // if the user dismisses the message box.
      cancelId: 1,
    });

    if (choice === 0) {
      // If the user selects "Quit Anyway", forces the window to close
      // and removes the file from the store
      clearableStoreKeys.forEach((keyName) => {
        store.delete(keyName);
      });
      store.set('edited', 'false');
      if (mainWindow === null) return;
      mainWindow.destroy();
    }
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();
  attachTitlebarToWindow(mainWindow);

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

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

// Renderer diagnostics, forwarded from the preload's window.electron.log. The level is matched
// explicitly rather than by indexing `log` with a string off the wire.
ipcMain.on(
  'log-message',
  (_event, level: string, message: string, meta?: unknown) => {
    // An if-chain rather than a lookup table: a table needs a function TYPE annotation, whose
    // mandatory parameter names the base no-unused-vars rule misreads as unused bindings. This
    // keeps `log` from ever being indexed by a string off the wire, with no rule turned off.
    const text = `[renderer] ${message}`;
    if (level === 'error') {
      if (meta === undefined) log.error(text);
      else log.error(text, meta);
    } else if (level === 'warn') {
      if (meta === undefined) log.warn(text);
      else log.warn(text, meta);
    } else if (level === 'debug') {
      if (meta === undefined) log.debug(text);
      else log.debug(text, meta);
    } else if (meta === undefined) log.info(text);
    else log.info(text, meta);
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
  earlyPath = filename;
  ipcMain.emit('app-open', [earlyPath]);
});

app
  .whenReady()
  .then(() => {
    createWindow();
    app.on('activate', (_event, hasVisibleWindows) => {
      if (!hasVisibleWindows) {
        createWindow();
      }
    });
  })
  .catch((err) => log.error('app failed to become ready', err));
