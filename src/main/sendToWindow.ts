import { BrowserWindow } from 'electron';
import { MainToWindow } from '../shared/channels';

// webContents.send, typed by the channel map in shared/channels.ts (#355): what the window's listener for
// the channel receives is what is sent here.
const sendToWindow = <C extends keyof MainToWindow>(
  win: BrowserWindow,
  channel: C,
  ...payload: MainToWindow[C]
): void => win.webContents.send(channel, ...payload);

export default sendToWindow;
