import log from 'electron-log';
import {
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
  app,
  dialog,
  nativeTheme,
  shell,
} from 'electron';

import path from 'path';
import fs from 'fs';
import {
  fileVersionMatchesCurrent,
  convertMidstFile,
  includeVersionInfo,
  serializeDocument,
} from '@midst-press/midst-format/convert';
import store from './store';
import { fontSizeOrDefault, MAX_FONT_SIZE, MIN_FONT_SIZE } from './fontSize';
import { Appearance, APPEARANCES, appearanceOrDefault } from './appearance';
import { existingConvertedCopy, writeConvertedFile } from './convertedFile';
import replaceFile from './replaceFile';
import { poemToRtf } from './rtf';
import { flushEditor } from './editorFlush';
import { showAbout } from './about';
import { logFilePath } from './logFile';
import installedGuideUrl from './guideLink';
import { describeError } from '../shared/errorSummary';
import { loadDataIntoWorkspace } from './util';
import * as saveFailure from './saveFailurePolicy';
import {
  activateLocale,
  i18n,
  languageName,
  languageOrder,
} from '../shared/i18n';

// A menu or IPC action that nothing awaits. If its promise rejects, the log says which action failed
// (#160); the unhandled-rejection handler could say only that something did. A synchronous throw is
// left to the uncaught-error handler, which also tells the poet. The promise is returned, settling once
// the action has, so a test can await a menu click and read what it wrote.
export const logIfRejected = (
  label: string,
  action: () => unknown
): unknown => {
  const result = action();
  if (result instanceof Promise) {
    return result.catch((err: unknown) =>
      log.error(`${label}: failed`, describeError(err))
    );
  }
  return result;
};

const handleUnsavedChanges = (mainWindow: BrowserWindow) => {
  if (store.get('edited') === 'false') {
    return false;
  }

  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    title: i18n._('dialog.unsavedChanges.title'),
    message: i18n._('dialog.unsavedChanges.message'),
    buttons: [i18n._('dialog.unsavedChanges.proceed'), i18n._('button.cancel')],
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
const findInPoem = (mainWindow: BrowserWindow) => {
  mainWindow.webContents.send('find-in-poem');
};
const toggleSpellcheck = (mainWindow: BrowserWindow) => {
  mainWindow.webContents.send('toggle-spellcheck');
};

const storedFontSize = () => fontSizeOrDefault(store.get('font-size'));
const increaseFontSize = (mainWindow: BrowserWindow) => {
  const fontSize = storedFontSize();
  if (fontSize >= MAX_FONT_SIZE) {
    return;
  }
  store.set('font-size', String(fontSize + 1));
  mainWindow.webContents.send('set-font-size', String(fontSize + 1));
};
// Light, dark or the OS's (GitHub #16). nativeTheme decides what prefers-color-scheme matches in the
// renderer, so the stylesheet and the MUI theme follow it with no message of their own.
export const setAppearance = (appearance: Appearance) => {
  store.set('appearance', appearance);
  nativeTheme.themeSource = appearance;
};

// At launch, before the window loads, so it never draws in the other scheme first.
export const applyStoredAppearance = () => {
  nativeTheme.themeSource = appearanceOrDefault(store.get('appearance'));
};

// The poet's language (editor #265). Kept in the store under 'language'; until the poet chooses there is
// none, and the app is in English (chosenLocale). The menus are rebuilt in the new language at once, and
// every window is told, so the menus and the window always agree.
export const setLanguage = (locale: string, mainWindow: BrowserWindow) => {
  const used = activateLocale(locale);
  store.set('language', used);
  // eslint-disable-next-line no-use-before-define -- the class is declared below, and this runs on a click
  new MenuBuilder(mainWindow).applyMenu();
  BrowserWindow.getAllWindows().forEach((w) =>
    w.webContents.send('set-locale', used)
  );
};

// Looked up when the menu is built, in the language chosen then.
const APPEARANCE_LABELS: Record<Appearance, () => string> = {
  system: () => i18n._('menu.view.appearance.system'),
  light: () => i18n._('menu.view.appearance.light'),
  dark: () => i18n._('menu.view.appearance.dark'),
};

const decreaseFontSize = (mainWindow: BrowserWindow) => {
  const fontSize = storedFontSize();

  if (fontSize <= MIN_FONT_SIZE) {
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
const untitled = () => i18n._('file.untitled');
const untitledMidst = () => `${untitled()}.midst`;

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

const saveFilters = () => [
  { name: i18n._('file.filter.midst'), extensions: ['midst'] },
  { name: i18n._('file.filter.allFiles'), extensions: ['*'] },
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
// unsaved. Whether the poet is told, and how the window shows it, is saveFailurePolicy.ts (#94).
// `byPoet` is true when they chose Save or Save As, or have just picked the file in a dialog.
// `saveElsewhere` is what "Save As…" in that message does.

// Off macOS the window's title says when the poem is not saved; the renderer sets it (#94). Sent only when
// that changes. On macOS the edited dot says it instead.
const sayWhetherSaved = (
  mainWindow: BrowserWindow,
  darwin: boolean,
  wasShown: boolean
) => {
  const shown = saveFailure.showsNotSaved();
  if (!darwin && shown !== wasShown)
    mainWindow.webContents.send('set-not-saved', shown);
};

// The window now holds another document: nothing about the last one's failed saves applies to it.
const forgetSaveFailures = (mainWindow: BrowserWindow, darwin: boolean) => {
  const wasShown = saveFailure.showsNotSaved();
  saveFailure.startAgain();
  sayWhetherSaved(mainWindow, darwin, wasShown);
};

// The write succeeded: the document is now this file, and saved.
const recordSaved = (
  mainWindow: BrowserWindow,
  darwin: boolean,
  filename: string
) => {
  forgetSaveFailures(mainWindow, darwin);
  store.set('filename', filename);
  store.set('baseFilename', path.basename(filename));
  rememberFolder(filename);
  if (darwin) {
    mainWindow.setDocumentEdited(false);
    mainWindow.setRepresentedFilename(filename);
  }
  // The renderer titles the window from this name, in one place (#125); main does not set the title.
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
    firstSave,
    saveElsewhere,
  }: {
    filename: string;
    reason: string;
    byPoet: boolean;
    firstSave: boolean;
    saveElsewhere: () => Promise<void>;
  }
) => {
  const wasShown = saveFailure.showsNotSaved();
  const tell = saveFailure.failed({
    filename,
    byPoet,
    firstSave,
    nothingUnsaved: store.get('edited') === 'false',
  });
  if (darwin && saveFailure.showsNotSaved()) mainWindow.setDocumentEdited(true);
  sayWhetherSaved(mainWindow, darwin, wasShown);
  if (!tell) return;
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'error',
    title: i18n._('dialog.couldNotSave.title'),
    message: i18n._('dialog.couldNotSave.message', {
      fileName: path.basename(filename),
    }),
    detail: i18n._('dialog.couldNotSave.detail', { reason }),
    buttons: [i18n._('dialog.couldNotSave.saveAs'), i18n._('button.ok')],
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
    action,
    filename,
    byPoet,
    firstSave,
    saveElsewhere,
  }: {
    action: 'save' | 'saveAs';
    filename: string;
    byPoet: boolean;
    firstSave: boolean;
    saveElsewhere: () => Promise<void>;
  }
) => {
  const meta = (store.get('meta') as string | undefined) ?? '';
  let fullContents: string;
  try {
    fullContents = includeVersionInfo(serializeDocument(text, history, meta));
  } catch (err) {
    // A parse error's message can quote the poem, so the log has the error's name only, and the poet
    // a fixed reason (#160).
    log.error(`${action}: the document could not be prepared for writing`, {
      filename,
      ...describeError(err),
    });
    await reportCouldNotSave(mainWindow, darwin, {
      filename,
      reason: i18n._('dialog.couldNotSave.notPrepared'),
      byPoet,
      firstSave,
      saveElsewhere,
    });
    return;
  }

  // What was written WHERE. This is exactly the pairing that failed in #12: the path of the
  // newly-opened document beside the previously-loaded document's text. With this in the log,
  // that defect is diagnosable from a user's log file rather than needing demonstration files.
  log.debug(`${action}: writing document`, {
    filename,
    textChars: typeof text === 'string' ? text.length : 0,
    historyChars: typeof history === 'string' ? history.length : 0,
  });
  try {
    replaceFile(filename, fullContents);
  } catch (err) {
    const reason = (err as Error).message;
    const { cleanupError } = err as { cleanupError?: unknown };
    log.error(`${action}: the document was not written`, {
      filename,
      reason,
      ...(cleanupError ? { cleanupError } : {}),
    });
    await reportCouldNotSave(mainWindow, darwin, {
      filename,
      reason,
      byPoet,
      firstSave,
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
    title: i18n._('dialog.saveAs.title'),
    message: i18n._('dialog.saveAs.message'),
    defaultPath:
      (store.get('filename') as string | undefined) ||
      path.join(dialogFolder(), untitledMidst()),
    filters: saveFilters(),
  });

  if (filename) {
    await writeAndRecord(mainWindow, darwin, document, {
      action: 'saveAs',
      filename,
      byPoet: true,
      firstSave: !store.get('filename'),
      saveElsewhere: () => saveAs(mainWindow, darwin),
    });
  }
};

// File > Export as RTF… (GitHub #26): the poem as it is now, in a Rich Text Format file. It reads the
// stored poem, as Save does. Whatever cannot be exported is said before anything is written, and the
// file is written beside its final name and renamed into place, so a failed write leaves no part of a
// file behind. Exporting changes nothing about the poem or its file.
const rtfFilters = () => [
  { name: i18n._('file.filter.rtf'), extensions: ['rtf'] },
  { name: i18n._('file.filter.allFiles'), extensions: ['*'] },
];

const cannotExport = (mainWindow: BrowserWindow, detail: string) =>
  dialog.showMessageBoxSync(mainWindow, {
    type: 'error',
    title: i18n._('dialog.couldNotExport.title'),
    message: i18n._('dialog.couldNotExport.message'),
    detail,
  });

const rtfDefaultPath = () => {
  const poemFile = store.get('filename') as string | undefined;
  const base = poemFile ? path.basename(poemFile, '.midst') : untitled();
  const folder =
    poemFile && fs.existsSync(path.dirname(poemFile))
      ? path.dirname(poemFile)
      : dialogFolder();
  return path.join(folder, `${base}.rtf`);
};

export const exportRtf = (mainWindow: BrowserWindow) => {
  const poem = store.get('poem') as string | undefined;
  if (poem === undefined) {
    log.error('exportRtf: no poem in the store; nothing written');
    cannotExport(mainWindow, i18n._('dialog.couldNotExport.noPoem'));
    return;
  }
  const result = poemToRtf(poem);
  if (!result.ok) {
    // The reason names a node or mark type, never the poem's text.
    log.warn('exportRtf: refused', { reason: result.reason });
    cannotExport(mainWindow, result.reason);
    return;
  }
  const filename = dialog.showSaveDialogSync(mainWindow, {
    title: i18n._('dialog.exportRtf.title'),
    message: i18n._('dialog.exportRtf.message'),
    defaultPath: rtfDefaultPath(),
    filters: rtfFilters(),
  });
  if (!filename) return;
  const partial = `${filename}.${process.pid}.partial`;
  try {
    fs.writeFileSync(partial, result.rtf, { flag: 'wx' });
    fs.renameSync(partial, filename);
  } catch (err) {
    const reason = (err as Error).message;
    log.error('exportRtf: the file was not written', { filename, reason });
    fs.rmSync(partial, { force: true });
    cannotExport(
      mainWindow,
      i18n._('dialog.couldNotExport.notWritten', { reason })
    );
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
  if (!stored && !saveFailure.mayAskWhereToSave(byPoet)) {
    // Its first save failed, and the panel would otherwise open at every pause in typing (#94). The poem
    // stays unsaved: Save and Save As still ask where it goes, and closing the window warns that it is unsaved.
    log.info(
      'autosave: not asking again where to save a document whose first save failed'
    );
    return;
  }
  const filename =
    stored ||
    dialog.showSaveDialogSync(mainWindow, {
      title: i18n._('dialog.firstSave.title'),
      message: i18n._('dialog.firstSave.message'),
      defaultPath: path.join(dialogFolder(), untitledMidst()),
      filters: saveFilters(),
    });
  if (filename) {
    await writeAndRecord(mainWindow, darwin, document, {
      action: 'save',
      filename,
      byPoet: byPoet || !stored,
      firstSave: !stored,
      saveElsewhere: () => saveAs(mainWindow, darwin),
    });
  } else {
    mainWindow.webContents.send('cancel-save');
  }
};

// New and Open first take the poem from the editor (#113), so typing in the last second counts as an unsaved
// change and the prompt asks about it.
export const newFile = async (mainWindow: BrowserWindow, darwin: boolean) => {
  await flushEditor(mainWindow);
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
  forgetSaveFailures(mainWindow, darwin);
  mainWindow.webContents.send('open-file', '', [], '');
  if (darwin) {
    mainWindow.setRepresentedFilename(untitled());
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
      log.error('open: the file could not be read', {
        filePath,
        code: err.code,
      });
      dialog.showMessageBoxSync(mainWindow, {
        title: i18n._('dialog.error.title'),
        type: 'error',
        message: i18n._('dialog.open.couldNotRead', {
          filePath,
          reason: err.message,
        }),
      });
      return;
    }
    if (fileVersionMatchesCurrent(data)) {
      try {
        loadDataIntoWorkspace(filePath, data, mainWindow, darwin);
      } catch (loadErr) {
        // The name only: a parse error's message quotes the file (#160).
        log.error('open: the file could not be loaded', {
          filePath,
          ...describeError(loadErr),
        });
        dialog.showMessageBoxSync(mainWindow, {
          title: i18n._('dialog.error.title'),
          type: 'error',
          message: i18n._('dialog.open.corrupted', { filePath }),
        });
      }
    } else {
      // An old file converted before has a converted copy beside it, holding the poet's work since. Offer
      // that copy first, and converting again as the other choice: they may want the original timelapse
      // back, or a newer editor may convert it better (Stuart, #7). A folder that cannot be searched is
      // logged, and the poet gets the plain offer to convert.
      let copy: string | undefined;
      try {
        copy = existingConvertedCopy(filePath);
      } catch (lookErr) {
        log.warn('open: could not look for an earlier converted copy', {
          filePath,
          ...describeError(lookErr),
        });
      }
      let response: number;
      if (copy) {
        log.info('open: version not recognised; a converted copy exists', {
          filePath,
          copy,
        });
        response = dialog.showMessageBoxSync(mainWindow, {
          type: 'warning',
          message: i18n._('dialog.open.convertedCopyExists.message'),
          detail: i18n._('dialog.open.convertedCopyExists.detail', {
            fileName: path.basename(copy),
          }),
          buttons: [
            i18n._('button.cancel'),
            i18n._('dialog.open.convertedCopyExists.convertAgain'),
            i18n._('dialog.open.convertedCopyExists.openCopy'),
          ],
          defaultId: 2,
          cancelId: 0,
        });
        if (response === 2) {
          log.info('open: opening the earlier converted copy', {
            filePath,
            copy,
          });
          openPath(mainWindow, darwin, copy);
          return;
        }
      } else {
        log.info('open: version not recognised; offering to convert', {
          filePath,
        });
        response = dialog.showMessageBoxSync(mainWindow, {
          type: 'warning',
          message: i18n._('dialog.open.versionNotRecognized'),
          buttons: [i18n._('button.cancel'), i18n._('dialog.open.convertFile')],
          defaultId: 1,
          cancelId: 0,
        });
      }
      if (response === 1) {
        // Each stage can throw. Nothing caught them, so a failed conversion vanished inside this
        // callback and the poet was told nothing (#160).
        let stage: 'convert' | 'write' | 'load' = 'convert';
        let newFilename: string | undefined;
        try {
          const newFileContents = includeVersionInfo(convertMidstFile(data));
          stage = 'write';
          newFilename = writeConvertedFile(filePath, newFileContents);
          stage = 'load';
          app.addRecentDocument(newFilename);
          loadDataIntoWorkspace(
            newFilename,
            newFileContents,
            mainWindow,
            darwin
          );
          log.info('open: converted', { filePath, newFilename });
        } catch (convertErr) {
          log.error('open: the file could not be converted', {
            filePath,
            stage,
            ...(newFilename ? { newFilename } : {}),
            ...describeError(convertErr),
          });
          dialog.showMessageBoxSync(mainWindow, {
            title: i18n._('dialog.error.title'),
            type: 'error',
            message: newFilename
              ? i18n._('dialog.open.convertedNotOpened', {
                  filePath: newFilename,
                })
              : i18n._('dialog.open.notConverted', { filePath }),
          });
        }
      }
    }
  });
};

export const openFile = async (
  mainWindow: BrowserWindow,
  darwin: boolean,
  earlyFilename?: string[]
) => {
  await flushEditor(mainWindow);
  const cancel = handleUnsavedChanges(mainWindow);
  if (cancel) {
    return;
  }
  let filename: string[] | undefined;
  if (earlyFilename) {
    filename = earlyFilename;
  } else {
    filename = dialog.showOpenDialogSync(mainWindow, {
      title: i18n._('dialog.open.title'),
      defaultPath: dialogFolder(),
      filters: saveFilters(),
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
    return this.applyMenu();
  }

  // Builds the menus in the active language and installs them. A language change calls this alone: the
  // development context menu is the window's, set up once by buildMenu.
  applyMenu(): Menu {
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
          id: 'menu.dev.inspectElement',
          label: i18n._('menu.dev.inspectElement'),
          click: () => {
            this.mainWindow.webContents.inspectElement(x, y);
          },
        },
      ]).popup({ window: this.mainWindow });
    });
  }

  // The items both platforms have. Labels come from the catalog, and each item's id is its catalog
  // key, which is how the user guide finds what the item does (shortcutTable.ts). A label marks the
  // Alt-key letter with '&' for Windows and Linux; `label` drops it in the macOS template. Accelerators
  // are passed in because macOS uses Command where the others use Ctrl.
  //
  // `darwin` is which template is being built, not which platform this is: the tests and the user
  // guide build both templates on one machine. Each build method sets it before building.
  private darwin = false;

  private label(text: string) {
    return this.darwin ? text.replace(/&/g, '') : text;
  }

  private reloadItem(accelerator: string) {
    return {
      id: 'menu.view.reload',
      label: this.label(i18n._('menu.view.reload')),
      accelerator,
      click: () => this.mainWindow.webContents.reload(),
    };
  }

  private fullScreenItem(accelerator: string) {
    return {
      id: 'menu.view.fullScreen',
      label: this.label(i18n._('menu.view.fullScreen')),
      accelerator,
      click: () =>
        this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen()),
    };
  }

  private devToolsItem(accelerator: string) {
    return {
      id: 'menu.view.devTools',
      label: this.label(i18n._('menu.view.devTools')),
      accelerator,
      click: () => this.mainWindow.webContents.toggleDevTools(),
    };
  }

  private textSizeItems(increase: string, decrease: string) {
    return [
      {
        id: 'menu.view.textSizeIncrease',
        label: this.label(i18n._('menu.view.textSizeIncrease')),
        accelerator: increase,
        click: () => increaseFontSize(this.mainWindow),
      },
      {
        id: 'menu.view.textSizeDecrease',
        label: this.label(i18n._('menu.view.textSizeDecrease')),
        accelerator: decrease,
        click: () => decreaseFontSize(this.mainWindow),
      },
    ];
  }

  private appearanceItem(): MenuItemConstructorOptions {
    const current = appearanceOrDefault(store.get('appearance'));
    return {
      id: 'menu.view.appearance',
      label: this.label(i18n._('menu.view.appearance')),
      submenu: APPEARANCES.map((appearance) => ({
        id: `menu.view.appearance.${appearance}`,
        label: this.label(APPEARANCE_LABELS[appearance]()),
        type: 'radio' as const,
        checked: appearance === current,
        click: () => setAppearance(appearance),
      })),
    };
  }

  // Each language by its own name, in languageOrder (English, the system's language, then the rest).
  private languageItem(): MenuItemConstructorOptions {
    return {
      id: 'menu.view.language',
      label: this.label(i18n._('menu.view.language')),
      submenu: languageOrder(app.getPreferredSystemLanguages()).map(
        (locale) => ({
          id: `menu.view.language.${locale}`,
          label: this.label(languageName(locale)),
          type: 'radio' as const,
          checked: locale === i18n.locale,
          click: () => setLanguage(locale, this.mainWindow),
        })
      ),
    };
  }

  // The spellcheck item has a different name on each platform.
  private modeItems(modifier: string) {
    return [
      {
        id: 'menu.edit.find',
        label: this.label(i18n._('menu.edit.find')),
        accelerator: `${modifier}+F`,
        click: () => findInPoem(this.mainWindow),
      },
      {
        id: 'menu.edit.toggleTimeline',
        label: this.label(i18n._('menu.edit.toggleTimeline')),
        accelerator: `${modifier}+T`,
        click: () => toggleEditMode(this.mainWindow),
      },
      this.darwin
        ? {
            id: 'menu.edit.spellcheck.mac',
            label: this.label(i18n._('menu.edit.spellcheck.mac')),
            accelerator: `${modifier}+;`,
            click: () => toggleSpellcheck(this.mainWindow),
          }
        : {
            id: 'menu.edit.spellcheck.other',
            label: this.label(i18n._('menu.edit.spellcheck.other')),
            accelerator: `${modifier}+;`,
            click: () => toggleSpellcheck(this.mainWindow),
          },
    ];
  }

  private saveItems(keys: [string, string], darwin: boolean) {
    // Disabled until the editor sends enable-save; main.ts finds them by id.
    return [
      {
        id: 'menu.file.save',
        label: this.label(i18n._('menu.file.save')),
        accelerator: keys[0],
        click: () =>
          logIfRejected('save', async () => {
            await flushEditor(this.mainWindow);
            await save(this.mainWindow, darwin);
          }),
        enabled: false,
      },
      {
        id: 'menu.file.saveAs',
        label: this.label(i18n._('menu.file.saveAs')),
        accelerator: keys[1],
        click: () =>
          logIfRejected('saveAs', async () => {
            await flushEditor(this.mainWindow);
            await saveAs(this.mainWindow, darwin);
          }),
        enabled: false,
      },
    ];
  }

  private exportRtfItem() {
    return {
      id: 'menu.file.exportRtf',
      label: this.label(i18n._('menu.file.exportRtf')),
      // exportRtf runs outside the flush's promise, as it did before the flush: a throw from it then reaches
      // uncaughtException, which tells the poet. Inside the promise it would only be logged (Clement, #188).
      click: () =>
        logIfRejected('exportRtf', async () => {
          await flushEditor(this.mainWindow);
          setImmediate(() => exportRtf(this.mainWindow));
        }),
    };
  }

  private aboutItem() {
    return {
      id: 'menu.app.about',
      label: this.label(i18n._('menu.app.about')),
      click: () => logIfRejected('about', () => showAbout(this.mainWindow)),
    };
  }

  private helpItems(): MenuItemConstructorOptions[] {
    return [
      {
        id: 'menu.help.learnMore',
        label: this.label(i18n._('menu.help.learnMore')),
        click: () =>
          logIfRejected('learn more', () =>
            shell.openExternal('https://midst.press')
          ),
      },
      {
        id: 'menu.help.documentation',
        label: this.label(i18n._('menu.help.documentation')),
        click: () =>
          logIfRejected('documentation', () =>
            shell.openExternal(installedGuideUrl())
          ),
      },
      // Shows the log in Finder, or File Explorer, so a poet can send it with a report without knowing where it is.
      {
        id: 'menu.help.showLogFile',
        label: this.label(i18n._('menu.help.showLogFile')),
        click: () => shell.showItemInFolder(logFilePath()),
      },
    ];
  }

  // Edit's items. macOS sends each to the first responder by selector; Windows and Linux use roles.
  private editItems(modifier: string, darwin: boolean) {
    const item = (
      id: string,
      text: string,
      accelerator: string,
      action: string
    ): DarwinMenuItemConstructorOptions =>
      darwin
        ? { id, label: this.label(text), accelerator, selector: `${action}:` }
        : {
            id,
            label: this.label(text),
            accelerator,
            role: action as MenuItemConstructorOptions['role'],
          };
    return [
      item('menu.edit.undo', i18n._('menu.edit.undo'), `${modifier}+Z`, 'undo'),
      item(
        'menu.edit.redo',
        i18n._('menu.edit.redo'),
        `Shift+${modifier}+Z`,
        'redo'
      ),
      { type: 'separator' as const },
      item('menu.edit.cut', i18n._('menu.edit.cut'), `${modifier}+X`, 'cut'),
      item('menu.edit.copy', i18n._('menu.edit.copy'), `${modifier}+C`, 'copy'),
      item(
        'menu.edit.paste',
        i18n._('menu.edit.paste'),
        `${modifier}+V`,
        'paste'
      ),
      // A role on Windows and Linux, as Cut, Copy and Paste beside it: `selector` is macOS only, so this item
      // did nothing there (#121).
      item(
        'menu.edit.selectAll',
        i18n._('menu.edit.selectAll'),
        `${modifier}+A`,
        'selectAll'
      ),
      ...this.modeItems(modifier),
    ];
  }

  buildDarwinTemplate(): MenuItemConstructorOptions[] {
    this.darwin = true;
    const subMenuAbout: DarwinMenuItemConstructorOptions = {
      id: 'menu.app',
      label: this.label(i18n._('menu.app')),
      submenu: [
        this.aboutItem(),
        { type: 'separator' },
        {
          id: 'menu.app.services',
          label: this.label(i18n._('menu.app.services')),
          submenu: [],
        },
        { type: 'separator' },
        {
          id: 'menu.app.hide',
          label: this.label(i18n._('menu.app.hide')),
          accelerator: 'Command+H',
          selector: 'hide:',
        },
        {
          id: 'menu.app.hideOthers',
          label: this.label(i18n._('menu.app.hideOthers')),
          accelerator: 'Command+Shift+H',
          selector: 'hideOtherApplications:',
        },
        {
          id: 'menu.app.showAll',
          label: this.label(i18n._('menu.app.showAll')),
          selector: 'unhideAllApplications:',
        },
        { type: 'separator' },
        {
          id: 'menu.app.quit',
          label: this.label(i18n._('menu.app.quit')),
          accelerator: 'Command+Q',
          click: () => app.quit(),
        },
      ],
    };
    const subMenuFile: DarwinMenuItemConstructorOptions = {
      id: 'menu.file',
      label: this.label(i18n._('menu.file')),
      submenu: [
        {
          id: 'menu.file.new',
          label: this.label(i18n._('menu.file.new')),
          accelerator: 'Command+N',
          click: () => {
            if (this.mainWindow.isDestroyed()) {
              store.set('poem', '');
              store.set('history', JSON.stringify([]));
              store.set('meta', '');
              store.set('filename', '');
              store.set('edited', JSON.stringify(false));
              saveFailure.startAgain();
              app.emit('activate', false);
            } else {
              logIfRejected('new', () => newFile(this.mainWindow, true));
            }
          },
        },
        ...this.saveItems(['Command+S', 'Command+Shift+S'], true),
        this.exportRtfItem(),
        {
          id: 'menu.file.open',
          label: this.label(i18n._('menu.file.open')),
          accelerator: 'Command+O',
          click: () =>
            logIfRejected('open', () => openFile(this.mainWindow, true)),
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
      id: 'menu.edit',
      label: this.label(i18n._('menu.edit')),
      submenu: this.editItems('Command', true),
    };
    const fullScreen = this.fullScreenItem('Ctrl+Command+F');
    const subMenuView: MenuItemConstructorOptions = {
      id: 'menu.view',
      label: this.label(i18n._('menu.view')),
      submenu: isDevelopment()
        ? [
            this.reloadItem('Command+R'),
            fullScreen,
            this.devToolsItem('Alt+Command+I'),
            ...this.textSizeItems('Command+Shift+=', 'Command+Shift+-'),
            this.appearanceItem(),
            this.languageItem(),
          ]
        : [
            fullScreen,
            ...this.textSizeItems('Command+Shift+=', 'Command+Shift+-'),
            this.appearanceItem(),
            this.languageItem(),
          ],
    };
    const subMenuWindow: DarwinMenuItemConstructorOptions = {
      id: 'menu.window',
      label: this.label(i18n._('menu.window')),
      submenu: [
        {
          id: 'menu.window.minimize',
          label: this.label(i18n._('menu.window.minimize')),
          accelerator: 'Command+M',
          selector: 'performMiniaturize:',
        },
        {
          id: 'menu.window.close',
          label: this.label(i18n._('menu.window.close')),
          accelerator: 'Command+W',
          selector: 'performClose:',
        },
        { type: 'separator' },
        {
          id: 'menu.window.bringAllToFront',
          label: this.label(i18n._('menu.window.bringAllToFront')),
          selector: 'arrangeInFront:',
        },
      ],
    };
    const subMenuHelp: MenuItemConstructorOptions = {
      id: 'menu.help',
      label: this.label(i18n._('menu.help')),
      submenu: this.helpItems(),
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
    this.darwin = false;
    const fullScreen = this.fullScreenItem('F11');
    return [
      {
        id: 'menu.file',
        label: this.label(i18n._('menu.file')),
        submenu: [
          ...this.saveItems(['Ctrl+S', 'Ctrl+Shift+S'], false),
          this.exportRtfItem(),
          {
            id: 'menu.file.new',
            label: this.label(i18n._('menu.file.new')),
            accelerator: 'Ctrl+N',
            click: () =>
              logIfRejected('new', () => newFile(this.mainWindow, false)),
          },
          {
            id: 'menu.file.open',
            label: this.label(i18n._('menu.file.open')),
            accelerator: 'Ctrl+O',
            click: () =>
              logIfRejected('open', () => openFile(this.mainWindow, false)),
          },
          {
            id: 'menu.file.close',
            label: this.label(i18n._('menu.file.close')),
            accelerator: 'Ctrl+W',
            click: () => this.mainWindow.close(),
          },
        ],
      },
      {
        id: 'menu.edit',
        label: this.label(i18n._('menu.edit')),
        submenu: this.editItems('Ctrl', false),
      },
      {
        id: 'menu.view',
        label: this.label(i18n._('menu.view')),
        submenu: isDevelopment()
          ? [
              this.reloadItem('Ctrl+R'),
              fullScreen,
              this.devToolsItem('Alt+Ctrl+I'),
              ...this.textSizeItems('Ctrl+=', 'Ctrl+-'),
              this.appearanceItem(),
              this.languageItem(),
            ]
          : [
              fullScreen,
              ...this.textSizeItems('Ctrl+=', 'Ctrl+-'),
              this.appearanceItem(),
              this.languageItem(),
            ],
      },
      {
        id: 'menu.help',
        label: this.label(i18n._('menu.help')),
        submenu: [...this.helpItems(), this.aboutItem()],
      },
    ];
  }
}
