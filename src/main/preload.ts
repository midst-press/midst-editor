// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import {
  CustomTitlebar,
  TitlebarColor,
} from '@jshafto/custom-electron-titlebar-update';
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { TITLEBAR_BACKGROUND } from './appearance';
import MIDST_LOGO from '../../assets/midst-logo.svg?raw';
import { StoreKey, StoreSchema } from '../shared/storeSchema';
import { MainToWindow, WindowToMain } from '../shared/channels';

let titlebar: CustomTitlebar | null = null;

window.addEventListener('DOMContentLoaded', () => {
  // The title bar takes the page background of the scheme in force, and changes with it (GitHub #16).
  const darkScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  const titlebarBackground = () =>
    TitlebarColor.fromHex(
      darkScheme?.matches ? TITLEBAR_BACKGROUND.dark : TITLEBAR_BACKGROUND.light
    );
  // Title bar implementation
  // eslint-disable-next-line no-new, no-import-assign
  titlebar = new CustomTitlebar({
    // itemBackgroundColor: TitlebarColor.fromHex('#FFF'),
    backgroundColor: titlebarBackground(),
    unfocusEffect: false,
    menuPosition: 'left',
    titleHorizontalAlignment: 'center',
    shadow: false,
    minHeight: 270,
    minWidth: 400,
  });
  if (process.platform !== 'darwin') {
    titlebar.updateMenuPosition('bottom');
    titlebar.updateTitleAlignment('left');
  }
  darkScheme?.addEventListener('change', () =>
    titlebar?.updateBackground(titlebarBackground())
  );
});

window.addEventListener('DOMContentLoaded', () => {
  // add midst logo to top of document
  // The squiggly M is assets/midst-logo.svg, the file a designer edits; the app adds its own id and classes.
  const svgLogo = document.createElement('div');
  svgLogo.innerHTML = MIDST_LOGO;
  const logo = svgLogo.querySelector('svg');
  logo?.setAttribute('id', 'svg');
  logo?.classList.add('svg', 'hide');
  document.body.insertBefore(svgLogo, document.body.firstChild);
  if (process.platform === 'linux' || process.platform === 'win32') {
    const svg = document.querySelector('.svg');
    if (svg !== null) {
      svg.classList.add('svg-linux');
    }
  }
});

const electronHandler = {
  // Typed by the channel maps in shared/channels.ts (#355).
  ipcRenderer: {
    sendMessage<C extends keyof WindowToMain>(
      channel: C,
      args: WindowToMain[C]
    ) {
      ipcRenderer.send(channel, args);
    },
    on<C extends keyof MainToWindow>(
      channel: C,
      func: (...args: MainToWindow[C]) => void
    ) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...(args as MainToWindow[C]));
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once<C extends keyof MainToWindow>(
      channel: C,
      func: (...args: MainToWindow[C]) => void
    ) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...(args as MainToWindow[C]));
      ipcRenderer.once(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
  },
  // Typed by StoreSchema (#355). main checks both again, since nothing types what crosses IPC. `set` does
  // not wait: a refused write is logged by main, which tells the poet when it is the poem, and waiting would
  // hold up typing on every autosave while electron-store rewrites its file (Cora, review of #370).
  store: {
    get<K extends StoreKey>(key: K): StoreSchema[K] | undefined {
      return ipcRenderer.sendSync('electron-store-get', key);
    },
    set<K extends StoreKey>(key: K, value: StoreSchema[K]): void {
      ipcRenderer.send('electron-store-set', key, value);
    },
  },
  titlebar: {
    updateTitle: (newTitle: string) => {
      if (titlebar !== null) {
        titlebar.updateTitle(newTitle);
      }
    },
  },
  // Renderer diagnostics go to the same electron-log file as the main process, via IPC, because
  // contextIsolation means the renderer cannot reach electron-log directly.
  log: {
    error(message: string, meta?: unknown) {
      ipcRenderer.send('log-message', 'error', message, meta);
    },
    warn(message: string, meta?: unknown) {
      ipcRenderer.send('log-message', 'warn', message, meta);
    },
    info(message: string, meta?: unknown) {
      ipcRenderer.send('log-message', 'info', message, meta);
    },
    debug(message: string, meta?: unknown) {
      ipcRenderer.send('log-message', 'debug', message, meta);
    },
  },
  versions: {
    isMac: process.platform === 'darwin',
  },
  // The languages in the order the main process shows them: English, the system's own, the rest (editor #265).
  languageOrder(): string[] {
    return ipcRenderer.sendSync('language-order');
  },
  // Whether the poet chose Continue in the box "Continue writing from here" asks (GitHub #90).
  confirmContinueWriting(): boolean {
    return ipcRenderer.sendSync('confirm-continue-writing') === true;
  },
  // View > Colours… saving and reading a colour set (GitHub #119): only in an audition build, where main registers
  // the handlers. Elsewhere it is undefined, so nothing can block on a channel with no listener.
  colourFiles:
    process.env.MIDST_COLOUR_AUDITION === 'true'
      ? {
          exportSet: (
            text: string,
            words: { filterName: string; defaultName: string }
          ): {
            ok: boolean;
            failure?: string;
            error?: string;
            path?: string;
          } => ipcRenderer.sendSync('colours-export', text, words),
          importSet: (words: {
            filterName: string;
            defaultName: string;
          }): {
            ok: boolean;
            failure?: string;
            error?: string;
            path?: string;
            text?: string;
          } => ipcRenderer.sendSync('colours-import', words),
        }
      : undefined,
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
