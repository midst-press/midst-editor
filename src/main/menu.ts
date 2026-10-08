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
import {
  fileVersionMatchesCurrent,
  convertMidstFile,
  includeVersionInfo,
  loadDataIntoWorkspace,
  getNewMidstFilename,
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

const increaseFontSize = (mainWindow: BrowserWindow) => {
  const fontSize = store.get('font-size') ? Number(store.get('font-size')) : 2;
  if (fontSize >= 4) {
    return;
  }
  store.set('font-size', fontSize + 1);
  mainWindow.webContents.send('set-font-size', String(fontSize + 1));
};
const decreaseFontSize = (mainWindow: BrowserWindow) => {
  const fontSize = store.get('font-size') ? Number(store.get('font-size')) : 2;

  if (fontSize <= 0) {
    return;
  }
  store.set('font-size', String(fontSize - 1));
  mainWindow.webContents.send('set-font-size', String(fontSize - 1));
};

export const save = async (mainWindow: BrowserWindow, darwin: boolean) => {
  let filename: string | undefined = store.get('filename') as string;
  if (!filename) {
    filename = dialog.showSaveDialogSync(mainWindow, {
      title: 'To begin, create a new Midst document.',
      message: 'To begin, create a new Midst document.',
      filters: [
        { name: 'Midst', extensions: ['midst'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
  }
  if (filename) {
    store.set('filename', filename);
    store.set('baseFilename', path.basename(filename));
    const text: string = store.get('poem') as string;
    const history: string = store.get('history') as string;
    const fullContents = includeVersionInfo(
      JSON.stringify({
        text,
        history: JSON.parse(history),
      })
    );
    if (darwin) {
      mainWindow.setDocumentEdited(false);
      mainWindow.setRepresentedFilename(filename);
    }
    mainWindow.setTitle(filename);
    mainWindow.webContents.send('set-filename', path.basename(filename));

    fs.writeFile(filename, fullContents, () => {});
    store.set('edited', JSON.stringify(false));
  } else {
    mainWindow.webContents.send('cancel-save');
  }
};

export const saveAs = async (mainWindow: BrowserWindow, darwin: boolean) => {
  const filename = dialog.showSaveDialogSync(mainWindow, {
    title: 'Save file as...',
    message: 'Save file as...',
    filters: [
      { name: 'Midst', extensions: ['midst'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (filename) {
    store.set('filename', filename);
    store.set('baseFilename', path.basename(filename));
    const text: string = store.get('poem') as string;
    const history: string = store.get('history') as string;
    const fullContents = includeVersionInfo(
      JSON.stringify({
        text,
        history: JSON.parse(history),
      })
    );
    if (darwin) {
      mainWindow.setDocumentEdited(false);
      mainWindow.setRepresentedFilename(filename);
    }
    mainWindow.setTitle(filename);
    mainWindow.webContents.send('set-filename', path.basename(filename));

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
      filters: [
        { name: 'Midst', extensions: ['midst'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
  }

  if (filename?.length) {
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
          const newFilename = getNewMidstFilename(filename![0]);
          fs.writeFileSync(newFilename, includeVersionInfo(newFileContents));
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
        ],
      },
    ];

    return templateDefault;
  }
}
