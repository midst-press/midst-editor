import log from 'electron-log';
import {
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
  app,
  dialog,
  shell,
} from 'electron';

import path from 'path';
import fs from 'fs';
import store from './store';
import { fontSizeFromStore } from './fontSize';
import { writeConvertedFile } from './convertedFile';
import { showAbout } from './about';
import {
  fileVersionMatchesCurrent,
  convertMidstFile,
  includeVersionInfo,
  serializeDocument,
  loadDataIntoWorkspace,
} from './util';

const handleUnsavedChanges = (mainWindow: BrowserWindow) => {
  if (store.get('edited') === 'false') {
    return false;
  }

  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    title: 'Unsaved changes',
    message:
      'Current document contains unsaved changes. Are you sure you want to proceed?',
    buttons: ['Proceed', 'Cancel'],
    // Sets the first option as the default option
    // if the user hits the Return key
    defaultId: 0,
    // Sets the second button as the button selected
    // if the user dismisses the message box.
    cancelId: 1,
  });

  if (choice === 0) {
    return false;
  }
  return true;
};

const toggleEditMode = (mainWindow: BrowserWindow) => {
  mainWindow.webContents.send('toggle-edit-mode');
};
const toggleSpellcheck = (mainWindow: BrowserWindow) => {
  mainWindow.webContents.send('toggle-spellcheck');
};

const storedFontSize = () => fontSizeFromStore(store.get('font-size'));
const increaseFontSize = (mainWindow: BrowserWindow) => {
  const fontSize = storedFontSize();
  if (fontSize >= 4) {
    return;
  }
  store.set('font-size', String(fontSize + 1));
  mainWindow.webContents.send('set-font-size', String(fontSize + 1));
};
const decreaseFontSize = (mainWindow: BrowserWindow) => {
  const fontSize = storedFontSize();

  if (fontSize <= 0) {
    return;
  }
  store.set('font-size', String(fontSize - 1));
  mainWindow.webContents.send('set-font-size', String(fontSize - 1));
};

// A document that is not in the store is not an empty document. newFile stores '' and '[]' for a
// new poem; undefined means the store was cleared (the window's close handler does that), and
// writing that out as an empty document could replace a poem on disk with nothing.
const storedDocument = () => {
  const text = store.get('poem') as string | undefined;
  const history = store.get('history') as string | undefined;
  return text === undefined || history === undefined ? null : { text, history };
};

// The name the save dialog offers. Without one, macOS offers whatever name was last typed into any save
// panel, which can be another application's file (midst-press/midst-editor#52).
const UNTITLED = 'Untitled.midst';

// The folder a dialog opens in. From Electron 43 a dialog given no folder opens in Downloads, and the
// system no longer remembers the last folder used, so the app remembers it: the folder of the last
// poem opened or saved, or Documents before there is one (electron/electron docs/breaking-changes.md,
// "Dialog methods default to Downloads directory").
const LAST_FOLDER = 'lastFolder';
const dialogFolder = (): string => {
  const last = store.get(LAST_FOLDER) as string | undefined;
  return last && fs.existsSync(last) ? last : app.getPath('documents');
};
const rememberFolder = (file: string) =>
  store.set(LAST_FOLDER, path.dirname(file));

export const save = async (mainWindow: BrowserWindow, darwin: boolean) => {
  const document = storedDocument();
  if (document === null) {
    log.error('save: no document in the store; nothing written');
    mainWindow.webContents.send('cancel-save');
    return;
  }
  const { text, history } = document;
  let filename: string | undefined = store.get('filename') as string;
  if (!filename) {
    filename = dialog.showSaveDialogSync(mainWindow, {
      title: 'To begin, create a new Midst document.',
      message: 'To begin, create a new Midst document.',
      defaultPath: path.join(dialogFolder(), UNTITLED),
      filters: [
        { name: 'Midst', extensions: ['midst'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
  }
  if (filename) {
    const meta = (store.get('meta') as string | undefined) ?? '';
    const fullContents = includeVersionInfo(
      serializeDocument(text, history, meta)
    );
    // Only once there is something to write: a document that cannot be serialized must not leave
    // its intended filename behind in the store.
    store.set('filename', filename);
    store.set('baseFilename', path.basename(filename));
    rememberFolder(filename);
    if (darwin) {
      mainWindow.setDocumentEdited(false);
      mainWindow.setRepresentedFilename(filename);
    }
    mainWindow.setTitle(filename);
    mainWindow.webContents.send('set-filename', path.basename(filename));

    // What was written WHERE. This is exactly the pairing that failed in #12: the path of the
    // newly-opened document beside the previously-loaded document's text. With this in the log,
    // that defect is diagnosable from a user's log file rather than needing demonstration files.
    log.debug('save: writing document', {
      filename,
      textChars: typeof text === 'string' ? text.length : 0,
      historyChars: typeof history === 'string' ? history.length : 0,
    });
    fs.writeFile(filename, fullContents, () => {});
    store.set('edited', JSON.stringify(false));
  } else {
    mainWindow.webContents.send('cancel-save');
  }
};

export const saveAs = async (mainWindow: BrowserWindow, darwin: boolean) => {
  const document = storedDocument();
  if (document === null) {
    log.error('saveAs: no document in the store; nothing written');
    return;
  }
  const { text, history } = document;
  const filename = dialog.showSaveDialogSync(mainWindow, {
    title: 'Save file as...',
    message: 'Save file as...',
    defaultPath:
      (store.get('filename') as string | undefined) ||
      path.join(dialogFolder(), UNTITLED),
    filters: [
      { name: 'Midst', extensions: ['midst'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (filename) {
    const meta = (store.get('meta') as string | undefined) ?? '';
    const fullContents = includeVersionInfo(
      serializeDocument(text, history, meta)
    );
    // Only once there is something to write: a document that cannot be serialized must not leave
    // its intended filename behind in the store.
    store.set('filename', filename);
    store.set('baseFilename', path.basename(filename));
    rememberFolder(filename);
    if (darwin) {
      mainWindow.setDocumentEdited(false);
      mainWindow.setRepresentedFilename(filename);
    }
    mainWindow.setTitle(filename);
    mainWindow.webContents.send('set-filename', path.basename(filename));

    // What was written WHERE. This is exactly the pairing that failed in #12: the path of the
    // newly-opened document beside the previously-loaded document's text. With this in the log,
    // that defect is diagnosable from a user's log file rather than needing demonstration files.
    log.debug('saveAs: writing document', {
      filename,
      textChars: typeof text === 'string' ? text.length : 0,
      historyChars: typeof history === 'string' ? history.length : 0,
    });
    fs.writeFile(filename, fullContents, () => {});
    store.set('edited', JSON.stringify(false));
  }
};

export const newFile = (mainWindow: BrowserWindow, darwin: boolean) => {
  const cancel = handleUnsavedChanges(mainWindow);
  if (cancel) {
    return;
  }
  store.set('poem', '');
  store.set('history', JSON.stringify([]));
  store.set('meta', '');
  store.set('filename', '');
  store.set('baseFilename', '');
  store.set('edited', JSON.stringify(false));
  mainWindow.webContents.send('open-file', '', [], '');
  if (darwin) {
    mainWindow.setRepresentedFilename('Untitled');
    mainWindow.setTitle('Untitled');
  }
};

export const openFile = async (
  mainWindow: BrowserWindow,
  darwin: boolean,
  earlyFilename?: string[]
) => {
  const cancel = handleUnsavedChanges(mainWindow);
  if (cancel) {
    return;
  }
  let filename: string[] | undefined;
  if (earlyFilename) {
    filename = earlyFilename;
  } else {
    filename = dialog.showOpenDialogSync(mainWindow, {
      title: 'Open...',
      defaultPath: dialogFolder(),
      filters: [
        { name: 'Midst', extensions: ['midst'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
  }

  if (filename?.length) {
    rememberFolder(filename[0]);
    fs.readFile(filename[0], 'utf8', (_err, data) => {
      if (fileVersionMatchesCurrent(data)) {
        try {
          loadDataIntoWorkspace(filename![0], data, mainWindow, darwin);
        } catch {
          dialog.showMessageBoxSync(mainWindow, {
            title: `Error`,
            type: 'error',
            message: `The file ${
              filename![0]
            } could not be opened. File may be corrupted. Please select another file and try again.`,
          });
        }
      } else {
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
            filename![0],
            includeVersionInfo(newFileContents)
          );
          app.addRecentDocument(newFilename);
          loadDataIntoWorkspace(
            newFilename,
            includeVersionInfo(newFileContents),
            mainWindow,
            darwin
          );
        }
      }
    });
  }
};

interface DarwinMenuItemConstructorOptions extends MenuItemConstructorOptions {
  selector?: string;
  submenu?: DarwinMenuItemConstructorOptions[] | Menu;
}

export default class MenuBuilder {
  mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  buildMenu(): Menu {
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUG_PROD === 'true'
    ) {
      this.setupDevelopmentEnvironment();
    }

    const template =
      process.platform === 'darwin'
        ? this.buildDarwinTemplate()
        : this.buildDefaultTemplate();

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    return menu;
  }

  setupDevelopmentEnvironment(): void {
    this.mainWindow.webContents.on('context-menu', (_, props) => {
      const { x, y } = props;

      Menu.buildFromTemplate([
        {
          label: 'Inspect element',
          click: () => {
            this.mainWindow.webContents.inspectElement(x, y);
          },
        },
      ]).popup({ window: this.mainWindow });
    });
  }

  buildDarwinTemplate(): MenuItemConstructorOptions[] {
    const subMenuAbout: DarwinMenuItemConstructorOptions = {
      label: 'Midst',
      submenu: [
        {
          label: 'About Midst',
          click: () => {
            showAbout(this.mainWindow);
          },
        },
        { type: 'separator' },
        { label: 'Services', submenu: [] },
        { type: 'separator' },
        {
          label: 'Hide Midst',
          accelerator: 'Command+H',
          selector: 'hide:',
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Shift+H',
          selector: 'hideOtherApplications:',
        },
        { label: 'Show All', selector: 'unhideAllApplications:' },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    };
    const subMenuFile: DarwinMenuItemConstructorOptions = {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'Command+N',
          click: () => {
            if (this.mainWindow.isDestroyed()) {
              store.set('poem', '');
              store.set('history', JSON.stringify([]));
              store.set('meta', '');
              store.set('filename', '');
              store.set('edited', JSON.stringify(false));
              app.emit('activate', false);
            } else {
              newFile(this.mainWindow, true);
            }
          },
        },
        {
          id: 'save',
          label: 'Save',
          accelerator: 'Command+S',
          click: () => save(this.mainWindow, true),
          enabled: false,
        },
        {
          id: 'save-as',
          label: 'Save As',
          accelerator: 'Command+S+Shift',
          click: () => saveAs(this.mainWindow, true),
          enabled: false,
        },
        {
          label: 'Open',
          accelerator: 'Command+O',
          click: () => openFile(this.mainWindow, true),
        },
        // commented this out since recent documents is not working
        // but leaving as a starting point to debug
        // {
        //   label: 'Open Recent',
        //   role: 'recentDocuments',
        //   submenu: [
        //     {
        //       label: 'Clear Recent',
        //       role: 'clearRecentDocuments',
        //     },
        //   ],
        // },
      ],
    };
    const subMenuEdit: DarwinMenuItemConstructorOptions = {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Command+Z', selector: 'undo:' },
        { label: 'Redo', accelerator: 'Shift+Command+Z', selector: 'redo:' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'Command+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'Command+C', selector: 'copy:' },
        { label: 'Paste', accelerator: 'Command+V', selector: 'paste:' },
        {
          label: 'Select All',
          accelerator: 'Command+A',
          selector: 'selectAll:',
        },
        {
          label: 'Toggle Edit Mode',
          accelerator: 'Command+E',
          click: () => toggleEditMode(this.mainWindow),
        },
        {
          label: 'Show/hide spellcheck',
          accelerator: 'Command+;',
          click: () => toggleSpellcheck(this.mainWindow),
        },
      ],
    };
    const subMenuViewDev: MenuItemConstructorOptions = {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'Command+R',
          click: () => {
            this.mainWindow.webContents.reload();
          },
        },
        {
          label: 'Toggle Full Screen',
          accelerator: 'Ctrl+Command+F',
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          },
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+Command+I',
          click: () => {
            this.mainWindow.webContents.toggleDevTools();
          },
        },
        {
          label: 'Increase text size',
          accelerator: 'Command+=',
          click: () => increaseFontSize(this.mainWindow),
        },
        {
          label: 'Decrease text size',
          accelerator: 'Command+-',
          click: () => decreaseFontSize(this.mainWindow),
        },
      ],
    };
    const subMenuViewProd: MenuItemConstructorOptions = {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Full Screen',
          accelerator: 'Ctrl+Command+F',
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          },
        },
        {
          label: 'Increase text size',
          accelerator: 'Command+Shift+=',
          click: () => increaseFontSize(this.mainWindow),
        },
        {
          label: 'Decrease text size',
          accelerator: 'Command+Shift+-',
          click: () => decreaseFontSize(this.mainWindow),
        },
      ],
    };
    const subMenuWindow: DarwinMenuItemConstructorOptions = {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'Command+M',
          selector: 'performMiniaturize:',
        },
        { label: 'Close', accelerator: 'Command+W', selector: 'performClose:' },
        { type: 'separator' },
        { label: 'Bring All to Front', selector: 'arrangeInFront:' },
      ],
    };
    const subMenuHelp: MenuItemConstructorOptions = {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click() {
            shell.openExternal('https://midst.press');
          },
        },
        {
          label: 'Documentation',
          click() {
            shell.openExternal('https://github.com/jshafto/midst-app');
          },
        },
      ],
    };

    const subMenuView =
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUG_PROD === 'true'
        ? subMenuViewDev
        : subMenuViewProd;

    return [
      subMenuAbout,
      subMenuFile,
      subMenuEdit,
      subMenuView,
      subMenuWindow,
      subMenuHelp,
    ];
  }

  buildDefaultTemplate() {
    const templateDefault = [
      {
        label: '&File',
        submenu: [
          {
            id: 'save',
            label: '&Save',
            accelerator: 'Ctrl+S',
            click: () => save(this.mainWindow, false),
            enabled: false,
          },
          {
            id: 'save-as',
            label: '&Save As',
            accelerator: 'Ctrl+Shift+S',
            click: () => saveAs(this.mainWindow, false),
            enabled: false,
          },
          {
            label: '&New',
            accelerator: 'Ctrl+N',
            click: () => newFile(this.mainWindow, false),
          },
          {
            label: '&Open',
            accelerator: 'Ctrl+O',
            click: () => openFile(this.mainWindow, false),
          },
          {
            label: '&Close',
            accelerator: 'Ctrl+W',
            click: () => {
              this.mainWindow.close();
            },
          },
        ],
      },
      {
        label: '&Edit',
        submenu: [
          { label: 'Undo', accelerator: 'Ctrl+Z', role: 'undo' },
          { label: 'Redo', accelerator: 'Shift+Ctrl+Z', role: 'redo' },
          { type: 'separator' },
          { label: 'Cut', accelerator: 'Ctrl+X', role: 'cut' },
          { label: 'Copy', accelerator: 'Ctrl+C', role: 'copy' },
          { label: 'Paste', accelerator: 'Ctrl+V', role: 'paste' },
          {
            label: 'Select All',
            accelerator: 'Ctrl+A',
            selector: 'selectall',
          },
          {
            label: 'Toggle Edit Mode',
            accelerator: 'Ctrl+E',
            click: () => toggleEditMode(this.mainWindow),
          },
          {
            label: 'Toggle Spellcheck',
            accelerator: 'Ctrl+;',
            click: () => toggleSpellcheck(this.mainWindow),
          },
        ] as MenuItemConstructorOptions[],
      },
      {
        label: '&View',
        submenu:
          process.env.NODE_ENV === 'development' ||
          process.env.DEBUG_PROD === 'true'
            ? [
                {
                  label: '&Reload',
                  accelerator: 'Ctrl+R',
                  click: () => {
                    this.mainWindow.webContents.reload();
                  },
                },
                {
                  label: 'Toggle &Full Screen',
                  accelerator: 'F11',
                  click: () => {
                    this.mainWindow.setFullScreen(
                      !this.mainWindow.isFullScreen()
                    );
                  },
                },
                {
                  label: 'Toggle &Developer Tools',
                  accelerator: 'Alt+Ctrl+I',
                  click: () => {
                    this.mainWindow.webContents.toggleDevTools();
                  },
                },
                {
                  label: 'Increase text size',
                  accelerator: 'Ctrl+=',
                  click: () => increaseFontSize(this.mainWindow),
                },
                {
                  label: 'Decrease text size',
                  accelerator: 'Ctrl+-',
                  click: () => decreaseFontSize(this.mainWindow),
                },
              ]
            : [
                {
                  label: 'Toggle &Full Screen',
                  accelerator: 'F11',
                  click: () => {
                    this.mainWindow.setFullScreen(
                      !this.mainWindow.isFullScreen()
                    );
                  },
                },
                {
                  label: 'Increase text size',
                  accelerator: 'Ctrl+=',
                  click: () => increaseFontSize(this.mainWindow),
                },
                {
                  label: 'Decrease text size',
                  accelerator: 'Ctrl+-',
                  click: () => decreaseFontSize(this.mainWindow),
                },
              ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Learn More',
            click() {
              shell.openExternal('https://midst.press');
            },
          },
          {
            label: 'Documentation',
            click() {
              shell.openExternal('https://github.com/jshafto/midst-app');
            },
          },
          {
            label: 'About Midst',
            click: () => {
              showAbout(this.mainWindow);
            },
          },
        ],
      },
    ];

    return templateDefault;
  }
}
