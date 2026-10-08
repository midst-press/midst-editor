// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import {
  CustomTitlebar,
  TitlebarColor,
} from '@jshafto/custom-electron-titlebar-update';
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels =
  | 'ipc-example'
  | 'open-file'
  | 'set-filename'
  | 'set-font-size'
  | 'toggle-edit-mode'
  | 'save-file'
  | 'toggle-spellcheck'
  | 'new-file'
  | 'new-file-from-menu'
  | 'button-open-file'
  | 'enable-save'
  | 'disable-save'
  | 'cancel-save'
  | 'app-open';

let titlebar: CustomTitlebar | null = null;

window.addEventListener('DOMContentLoaded', () => {
  // Title bar implementation
  // eslint-disable-next-line no-new, no-import-assign
  titlebar = new CustomTitlebar({
    // itemBackgroundColor: TitlebarColor.fromHex('#FFF'),
    backgroundColor: TitlebarColor.fromHex('#FFF5EE'),
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
});

window.addEventListener('DOMContentLoaded', () => {
  // add midst logo to top of document
  const svgLogo = document.createElement('div');
  svgLogo.innerHTML = `<svg
  viewBox="0 0 182.2 96"
  id="svg"
  class="svg hide"
>
 <path
    d="M22.51,82.3l-.53,0a11.05,11.05,0,0,1-8.62-5.16,1,1,0,0,1,.37-1.37,1,1,0,0,1,1.37.38,9,9,0,0,0,7,4.16c4.47.25,12.14-2.61,23.32-17.71C52.56,53,62.83,38.87,69.63,29.52,72.69,25.31,75,22.11,76,20.81c4.29-5.84,8.07-8.45,10.34-7.19,2,1.11,2,4.66-.17,10C85,26.52,72.68,56.76,70,62.84c-1.72,3.91-4.93,11.18-4,12.24a.93.93,0,0,0,.75.32c.46,0,1.79-.37,4.06-3.26,5.56-7,19.06-28.49,27.12-41.3,3-4.81,5.22-8.29,6.07-9.56,1.81-2.68,5.23-4.88,7.61-3.75,1.5.71,2.92,2.86,1.07,9-.52,1.76-3.35,10-6.08,17.86-2.06,6-4,11.62-4.7,13.73l-.55,1.65C99.57,65.36,97.85,70.6,98.86,72c.07.1.25.36,1,.37.93,0,2.65,0,8-9.81,6.25-11.45,13.43-25.5,17.29-33,1-2,1.81-3.55,2.27-4.44,2.71-5.2,6.24-6.46,8.64-5.9a5.24,5.24,0,0,1,3.88,5.21c0,2.05-1.42,6.6-3.27,12.36-.6,1.89-1.23,3.85-1.83,5.79-1,3.21-1.9,6.07-2.71,8.61-2.75,8.6-4.41,13.79-3.3,15.87a2.41,2.41,0,0,0,1.65,1.15c3.53,1,6.53-5.44,7.66-8.25,2.53-6.32,4.9-12.11,6.94-17.1,2.61-6.37,4.66-11.41,5.85-14.56,1.75-4.67,4.94-7.4,8.46-7.31a6.58,6.58,0,0,1,6.06,4.63c.93,2.92-.86,8.25-3.13,15l-.32,1c-1.79,5.33-3,10-4.07,14.33a6.17,6.17,0,0,0,.66,5.3,4.42,4.42,0,0,0,3.62,1.59c.53,0,1.29,0,2.09.09,1.16.06,2.48.13,3.26.1a1,1,0,1,1,.06,2c-.87,0-2.16,0-3.42-.1-.78,0-1.51-.08-2-.09A6.36,6.36,0,0,1,157,62.41c-1.34-1.73-1.7-4.22-1-7,1.06-4.33,2.3-9.09,4.11-14.49l.33-1c2-5.89,3.85-11.46,3.12-13.76A4.6,4.6,0,0,0,159.34,23h-.05c-2.64,0-5.06,2.21-6.49,6-1.2,3.18-3.26,8.23-5.87,14.61-2,5-4.4,10.78-6.93,17.09-2.85,7.12-6.43,10.47-10.07,9.43A4.37,4.37,0,0,1,127.07,68c-1.51-2.82.05-7.7,3.16-17.42C131,48,132,45.17,132.93,42c.6-1.94,1.23-3.91,1.84-5.81,1.65-5.14,3.2-10,3.17-11.7a3.24,3.24,0,0,0-2.33-3.31c-1.67-.39-4.24.69-6.41,4.87l-2.27,4.43c-3.86,7.56-11.05,21.63-17.31,33.09-5,9.18-7.32,10.9-9.82,10.86a3,3,0,0,1-2.57-1.21c-1.6-2.25-.06-6.92,2.27-14l.55-1.66c.69-2.12,2.64-7.77,4.71-13.75,2.6-7.53,5.55-16.06,6.06-17.78,1.28-4.3.83-6.26,0-6.66-1.06-.51-3.51.72-5.09,3.06-.83,1.24-3.13,4.89-6,9.51C91.59,44.75,78.06,66.24,72.43,73.38c-2.05,2.6-3.92,4-5.55,4a2.93,2.93,0,0,1-2.29-1c-1.7-1.83-.13-6,3.58-14.41,2.67-6.06,15-36.26,16.12-39.15,2.15-5.42,1.47-7.29,1.06-7.51-.67-.37-3.45.76-7.76,6.62-1,1.3-3.29,4.5-6.35,8.71-6.8,9.35-17.07,23.48-24.18,33.07C37.87,76.18,29.62,82.41,22.51,82.3Z"
    id="path1786" />
</svg>
`;
  document.body.insertBefore(svgLogo, document.body.firstChild);
  if (process.platform === 'linux' || process.platform === 'win32') {
    const svg = document.querySelector('.svg');
    if (svg !== null) {
      svg.classList.add('svg-linux');
    }
  }
});

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, args: unknown[]) {
      ipcRenderer.send(channel, args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
  store: {
    get(key: string) {
      return ipcRenderer.sendSync('electron-store-get', key);
    },
    set(property: string, val: string) {
      ipcRenderer.send('electron-store-set', property, val);
    },
  },
  titlebar: {
    updateTitle: (newTitle: string) => {
      if (titlebar !== null) {
        titlebar.updateTitle(newTitle);
      }
    },
  },
  versions: {
    isMac: process.platform === 'darwin',
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
