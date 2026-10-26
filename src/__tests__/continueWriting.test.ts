import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import confirmContinueWriting, {
  CANCEL,
  CONTINUE,
} from '../main/continueWriting';

jest.mock('electron', () => ({
  dialog: { showMessageBoxSync: jest.fn() },
}));

const showMessageBoxSync = dialog.showMessageBoxSync as jest.Mock;
const win = {} as BrowserWindow;

// GitHub #90: "Continue writing from here" asks first, in Annelyse's words, with Timeline as #317 names it.
describe('confirmContinueWriting', () => {
  beforeEach(() => showMessageBoxSync.mockReset());

  it('asks in Annelyse’s words, with Cancel and Continue, Continue the default', () => {
    showMessageBoxSync.mockReturnValue(CONTINUE);
    confirmContinueWriting(win);
    expect(showMessageBoxSync).toHaveBeenCalledTimes(1);
    const [parent, options] = showMessageBoxSync.mock.calls[0];
    expect(parent).toBe(win);
    expect(options).toMatchObject({
      message:
        'Do you want to continue writing from this point on your Timeline?',
      detail: 'None of your work will be lost.',
      buttons: ['Cancel', 'Continue'],
      defaultId: CONTINUE,
      cancelId: CANCEL,
    });
  });

  it('is true only for Continue', () => {
    showMessageBoxSync.mockReturnValue(CONTINUE);
    expect(confirmContinueWriting(win)).toBe(true);
    showMessageBoxSync.mockReturnValue(CANCEL);
    expect(confirmContinueWriting(win)).toBe(false);
  });
});
