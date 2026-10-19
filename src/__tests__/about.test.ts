/** @jest-environment node */
import { app, clipboard, dialog, shell } from 'electron';
import { credits, aboutLine, showAbout } from '../main/about';

jest.mock('electron', () => ({
  app: { isPackaged: true, getVersion: jest.fn(() => '0.3.0-beta.1') },
  clipboard: { writeText: jest.fn() },
  dialog: { showMessageBox: jest.fn() },
  shell: { openExternal: jest.fn() },
  BrowserWindow: jest.fn(),
}));

const showMessageBox = dialog.showMessageBox as unknown as jest.Mock;
const writeText = clipboard.writeText as jest.Mock;
const openExternal = shell.openExternal as jest.Mock;
const setPackaged = (packaged: boolean) => {
  (app as { isPackaged: boolean }).isPackaged = packaged;
};
const fakeWindow = {} as never;

const LINE =
  'Version v0.3.0-beta.1, commit a1b2c3d, committed 2026-10-13 20:30 UTC';

beforeEach(() => {
  jest.clearAllMocks();
  setPackaged(true);
  process.env.MIDST_BUILD_COMMIT = 'a1b2c3d';
  process.env.MIDST_BUILD_COMMITTED_AT = '2026-10-14T09:30:00+13:00';
});
afterAll(() => {
  delete process.env.MIDST_BUILD_COMMIT;
  delete process.env.MIDST_BUILD_COMMITTED_AT;
});

describe('aboutLine', () => {
  it('shows the package version as its release tag, with the commit and its date', () => {
    expect(aboutLine()).toBe(LINE);
  });

  it('is a development build when running from source, whatever the environment holds', () => {
    setPackaged(false);
    expect(aboutLine()).toBe('Development build');
  });

  it('shows the version alone when the package was built without git', () => {
    process.env.MIDST_BUILD_COMMIT = '';
    process.env.MIDST_BUILD_COMMITTED_AT = '';
    expect(aboutLine()).toBe('Version v0.3.0-beta.1');
  });
});

describe('credits', () => {
  it('names the director, then the developers, one to a line', () => {
    expect(credits().split('\n')).toEqual([
      'Director: Annelyse Gelman',
      '',
      'Developers:',
      'Stuart Swerdloff and the SJS Targeted Solutions Kindled team',
      'Juliet Shafto',
      'Jason Gillis-Grier',
    ]);
  });
});

describe('showAbout', () => {
  it('shows the line in a dialog on the window', async () => {
    showMessageBox.mockResolvedValue({ response: 0 });
    await showAbout(fakeWindow);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    const [parent, options] = showMessageBox.mock.calls[0];
    expect(parent).toBe(fakeWindow);
    expect(options.detail).toBe(`${LINE}\n\n${credits()}`);
    expect(options.buttons).toEqual(['OK', 'Copy', 'User Guide']);
    // Return and Escape both close it without copying.
    expect(options.defaultId).toBe(0);
    expect(options.cancelId).toBe(0);
  });

  it('copies nothing when the dialog is closed with OK', async () => {
    showMessageBox.mockResolvedValue({ response: 0 });
    await showAbout(fakeWindow);
    expect(writeText).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('puts the line on the clipboard when Copy is chosen', async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    await showAbout(fakeWindow);
    expect(writeText).toHaveBeenCalledWith(LINE);
    // Only the version line, for pasting into a report; not the credits.
    expect(writeText.mock.calls[0][0]).not.toContain('Annelyse');
  });

  it('opens the guide for this version, at its release tag, when User Guide is chosen, and copies nothing (#102)', async () => {
    showMessageBox.mockResolvedValue({ response: 2 });
    await showAbout(fakeWindow);
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/midst-press/midst-editor/blob/v0.3.0-beta.1/docs/user-guide.md'
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('a development build opens the guide on main (#102)', async () => {
    setPackaged(false);
    showMessageBox.mockResolvedValue({ response: 2 });
    await showAbout(fakeWindow);
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/midst-press/midst-editor/blob/main/docs/user-guide.md'
    );
  });
});
