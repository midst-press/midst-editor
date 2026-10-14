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
import { USER_GUIDE_URL } from '../shared/userGuide';
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
    // Return keeps the work: the default button is Cancel, never the one that discards (#40).
    defaultId: 1,
    // Dismissing the message box is Cancel too.
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

const SAVE_FILTERS = [
  { name: 'Midst', extensions: ['midst'] },
  { name: 'All Files', extensions: ['*'] },
];

// Writes the stored document to `filename`, and only when the write has succeeded records it as saved:
// the filename, the window's title and edited dot, and `edited` in the store.
//
// The write is synchronous on purpose. `edited` is what New, Open and closing the window trust before
// they discard the document, so it must not say "saved" before the bytes are in the file, nor after a
// write that failed (#37). A callback would also let the poet type between the write and its
// callback, and the callback would then mark those keystrokes as saved.
//
// When the write fails nothing is recorded: the document keeps its previous filename and stays
// unsaved. Whether the poet is told depends on who started the save:
//   - `byPoet`: they chose Save or Save As, or have just picked the file in a dialog. Always told.
//   - otherwise it is one of the editor's own saves (on opening a document, a second after typing,
//     on leaving for the replay). Not told when nothing was unsaved: opening a read-only poem to
//     read it is not a failure worth a message. And told only ONCE per file while it keeps failing:
//     an autosave follows every pause in typing, and a message after each one would make a poem in
//     a read-only place impossible to work on. The macOS edited dot stays on throughout.
// `saveElsewhere` is what "Save As…" in that message does.
let toldCouldNotSave: string | undefined;

// The write succeeded: the document is now this file, and saved.
const recordSaved = (
  mainWindow: BrowserWindow,
  darwin: boolean,
  filename: string
) => {
  toldCouldNotSave = undefined;
  store.set('filename', filename);
  store.set('baseFilename', path.basename(filename));
  rememberFolder(filename);
  if (darwin) {
    mainWindow.setDocumentEdited(false);
    mainWindow.setRepresentedFilename(filename);
  }
  mainWindow.setTitle(filename);
  mainWindow.webContents.send('set-filename', path.basename(filename));
  store.set('edited', JSON.stringify(false));
};

// The write failed: nothing is recorded, and the poet is told when the rules above say so.
const reportCouldNotSave = async (
  mainWindow: BrowserWindow,
  darwin: boolean,
  {
    filename,
    reason,
    byPoet,
    saveElsewhere,
  }: {
    filename: string;
    reason: string;
    byPoet: boolean;
    saveElsewhere: () => Promise<void>;
  }
) => {
  const nothingUnsaved = store.get('edited') === 'false';
  if (!byPoet && nothingUnsaved) return;
  if (darwin && !nothingUnsaved) mainWindow.setDocumentEdited(true);
  if (!byPoet && toldCouldNotSave === filename) return;
  toldCouldNotSave = filename;
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'error',
    title: 'Could not save',
    message: `Midst could not save "${path.basename(filename)}".`,
    detail: `${reason}\n\nYour poem is still open, and it has not been saved to that file. Choose "Save As…" to save it somewhere else.`,
    buttons: ['Save As…', 'OK'],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice === 0) await saveElsewhere();
};

const writeAndRecord = async (
  mainWindow: BrowserWindow,
  darwin: boolean,
  { text, history }: { text: string; history: string },
  {
    label,
    filename,
    byPoet,
    saveElsewhere,
  }: {
    label: 'save' | 'saveAs';
    filename: string;
    byPoet: boolean;
    saveElsewhere: () => Promise<void>;
  }
) => {
  const meta = (store.get('meta') as string | undefined) ?? '';
  const fullContents = includeVersionInfo(
    serializeDocument(text, history, meta)
  );

  // What was written WHERE. This is exactly the pairing that failed in #12: the path of the
  // newly-opened document beside the previously-loaded document's text. With this in the log,
  // that defect is diagnosable from a user's log file rather than needing demonstration files.
  log.debug(`${label}: writing document`, {
    filename,
    textChars: typeof text === 'string' ? text.length : 0,
    historyChars: typeof history === 'string' ? history.length : 0,
  });
  try {
    fs.writeFileSync(filename, fullContents);
  } catch (err) {
    const reason = (err as Error).message;
    log.error(`${label}: the document was not written`, { filename, reason });
    await reportCouldNotSave(mainWindow, darwin, {
      filename,
      reason,
      byPoet,
      saveElsewhere,
    });
    return;
  }
  recordSaved(mainWindow, darwin, filename);
};

export const saveAs = async (mainWindow: BrowserWindow, darwin: boolean) => {
  const document = storedDocument();
  if (document === null) {
    log.error('saveAs: no document in the store; nothing written');
    return;
  }
  const filename = dialog.showSaveDialogSync(mainWindow, {
    title: 'Save file as...',
    message: 'Save file as...',
    defaultPath:
      (store.get('filename') as string | undefined) ||
      path.join(dialogFolder(), UNTITLED),
    filters: SAVE_FILTERS,
  });

  if (filename) {
    await writeAndRecord(mainWindow, darwin, document, {
      label: 'saveAs',
      filename,
      byPoet: true,
      saveElsewhere: () => saveAs(mainWindow, darwin),
    });
  }
};

// `byPoet` is false for the editor's own saves (the 'save-file' message): see writeAndRecord.
export const save = async (
  mainWindow: BrowserWindow,
  darwin: boolean,
  byPoet = true
) => {
  const document = storedDocument();
  if (document === null) {
    log.error('save: no document in the store; nothing written');
    mainWindow.webContents.send('cancel-save');
    return;
  }
  const stored = store.get('filename') as string | undefined;
  const filename =
    stored ||
    dialog.showSaveDialogSync(mainWindow, {
      title: 'To begin, create a new Midst document.',
      message: 'To begin, create a new Midst document.',
      defaultPath: path.join(dialogFolder(), UNTITLED),
      filters: SAVE_FILTERS,
    });
  if (filename) {
    await writeAndRecord(mainWindow, darwin, document, {
      label: 'save',
      filename,
      byPoet: byPoet || !stored,
      saveElsewhere: () => saveAs(mainWindow, darwin),
    });
  } else {
    mainWindow.webContents.send('cancel-save');
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

// Read a .midst file into the workspace, offering to convert one of an older version. File > Open,
// Open Recent and a file handed to the app at launch all come here, so they behave the same.
export const openPath = (
  mainWindow: BrowserWindow,
  darwin: boolean,
  filePath: string
) => {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (mainWindow.isDestroyed?.()) {
      return;
    }
    if (err) {
      // A missing or unreadable file, or a folder: say so. It is not a file of another version (#114).
      dialog.showMessageBoxSync(mainWindow, {
        title: `Error`,
        type: 'error',
        message: `The file ${filePath} could not be opened: ${err.message}`,
      });
      return;
    }
    if (fileVersionMatchesCurrent(data)) {
      try {
        loadDataIntoWorkspace(filePath, data, mainWindow, darwin);
      } catch {
        dialog.showMessageBoxSync(mainWindow, {
          title: `Error`,
          type: 'error',
          message: `The file ${filePath} could not be opened. File may be corrupted. Please select another file and try again.`,
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
          filePath,
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
    openPath(mainWindow, darwin, filename[0]);
  }
};

// The development menus (Reload, Developer Tools, Inspect element) also show in a packaged build
// started with DEBUG_PROD=true.
export const isDevelopment = () =>
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

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
    if (isDevelopment()) {
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

  // The items both platforms have. Labels and accelerators are passed in because they differ: '&'
  // marks the Alt-key letter on Windows and Linux, and macOS uses Command where they use Ctrl.

  private reloadItem(label: string, accelerator: string) {
    return {
      label,
      accelerator,
      click: () => this.mainWindow.webContents.reload(),
    };
  }

  private fullScreenItem(label: string, accelerator: string) {
    return {
      label,
      accelerator,
      click: () =>
        this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen()),
    };
  }

  private devToolsItem(label: string, accelerator: string) {
    return {
      label,
      accelerator,
      click: () => this.mainWindow.webContents.toggleDevTools(),
    };
  }

  private textSizeItems(increase: string, decrease: string) {
    return [
      {
        label: 'Increase text size',
        accelerator: increase,
        click: () => increaseFontSize(this.mainWindow),
      },
      {
        label: 'Decrease text size',
        accelerator: decrease,
        click: () => decreaseFontSize(this.mainWindow),
      },
    ];
  }

  private modeItems(modifier: string, spellcheckLabel: string) {
    return [
      {
        label: 'Toggle Edit Mode',
        accelerator: `${modifier}+E`,
        click: () => toggleEditMode(this.mainWindow),
      },
      {
        label: spellcheckLabel,
        accelerator: `${modifier}+;`,
        click: () => toggleSpellcheck(this.mainWindow),
      },
    ];
  }

  private saveItems(
    saveLabel: string,
    saveAsLabel: string,
    keys: [string, string],
    darwin: boolean
  ) {
    // Disabled until the editor sends enable-save; main.ts finds them by id.
    return [
      {
        id: 'save',
        label: saveLabel,
        accelerator: keys[0],
        click: () => save(this.mainWindow, darwin),
        enabled: false,
      },
      {
        id: 'save-as',
        label: saveAsLabel,
        accelerator: keys[1],
        click: () => saveAs(this.mainWindow, darwin),
        enabled: false,
      },
    ];
  }

  private aboutItem() {
    return { label: 'About Midst', click: () => showAbout(this.mainWindow) };
  }

  private static helpItems(): MenuItemConstructorOptions[] {
    return [
      {
        label: 'Learn More',
        click: () => shell.openExternal('https://midst.press'),
      },
      {
        label: 'Documentation',
        click: () => shell.openExternal(USER_GUIDE_URL),
      },
    ];
  }

  buildDarwinTemplate(): MenuItemConstructorOptions[] {
    const subMenuAbout: DarwinMenuItemConstructorOptions = {
      label: 'Midst',
      submenu: [
        this.aboutItem(),
        { type: 'separator' },
        { label: 'Services', submenu: [] },
        { type: 'separator' },
        { label: 'Hide Midst', accelerator: 'Command+H', selector: 'hide:' },
        {
          label: 'Hide Others',
          accelerator: 'Command+Shift+H',
          selector: 'hideOtherApplications:',
        },
        { label: 'Show All', selector: 'unhideAllApplications:' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() },
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
        ...this.saveItems(
          'Save',
          'Save As',
          ['Command+S', 'Command+S+Shift'],
          true
        ),
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
        ...this.modeItems('Command', 'Show/hide spellcheck'),
      ],
    };
    const fullScreen = this.fullScreenItem(
      'Toggle Full Screen',
      'Ctrl+Command+F'
    );
    const subMenuView: MenuItemConstructorOptions = {
      label: 'View',
      submenu: isDevelopment()
        ? [
            this.reloadItem('Reload', 'Command+R'),
            fullScreen,
            this.devToolsItem('Toggle Developer Tools', 'Alt+Command+I'),
            ...this.textSizeItems('Command+=', 'Command+-'),
          ]
        : [
            fullScreen,
            ...this.textSizeItems('Command+Shift+=', 'Command+Shift+-'),
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
      submenu: MenuBuilder.helpItems(),
    };

    return [
      subMenuAbout,
      subMenuFile,
      subMenuEdit,
      subMenuView,
      subMenuWindow,
      subMenuHelp,
    ];
  }

  buildDefaultTemplate(): MenuItemConstructorOptions[] {
    const fullScreen = this.fullScreenItem('Toggle &Full Screen', 'F11');
    return [
      {
        label: '&File',
        submenu: [
          ...this.saveItems(
            '&Save',
            '&Save As',
            ['Ctrl+S', 'Ctrl+Shift+S'],
            false
          ),
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
            click: () => this.mainWindow.close(),
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
          } as MenuItemConstructorOptions,
          ...this.modeItems('Ctrl', 'Toggle Spellcheck'),
        ],
      },
      {
        label: '&View',
        submenu: isDevelopment()
          ? [
              this.reloadItem('&Reload', 'Ctrl+R'),
              fullScreen,
              this.devToolsItem('Toggle &Developer Tools', 'Alt+Ctrl+I'),
              ...this.textSizeItems('Ctrl+=', 'Ctrl+-'),
            ]
          : [fullScreen, ...this.textSizeItems('Ctrl+=', 'Ctrl+-')],
      },
      {
        label: 'Help',
        submenu: [...MenuBuilder.helpItems(), this.aboutItem()],
      },
    ];
  }
}
