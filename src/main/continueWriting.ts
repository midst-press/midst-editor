import { BrowserWindow, dialog } from 'electron';
import { i18n } from '../shared/i18n';

// "Continue writing from here" asks first (GitHub #90, Annelyse's words). Cancel leaves the Timeline as it was;
// Continue goes on to the restart. A native box, as every other question the app asks is.
export const CANCEL = 0;
export const CONTINUE = 1;

export default function confirmContinueWriting(win: BrowserWindow): boolean {
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    message: i18n._('restart.confirm.message'),
    detail: i18n._('restart.confirm.detail'),
    buttons: [i18n._('button.cancel'), i18n._('restart.confirm.continue')],
    defaultId: CONTINUE,
    cancelId: CANCEL,
    noLink: true,
  });
  return choice === CONTINUE;
}
