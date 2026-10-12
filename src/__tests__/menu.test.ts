/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app, dialog, Menu, shell } from 'electron';
import MenuBuilder, { newFile, openFile, save, saveAs } from '../main/menu';

// Synthetic documents only: invented words, never a poem. Files named .midst live in a temporary
// directory and are removed after each test.

const mockStore = new Map<string, unknown>();
jest.mock('electron', () => ({
  app: { quit: jest.fn(), emit: jest.fn(), addRecentDocument: jest.fn() },
  dialog: {
    showMessageBoxSync: jest.fn(),
    showSaveDialogSync: jest.fn(),
    showOpenDialogSync: jest.fn(),
  },
  Menu: { buildFromTemplate: jest.fn(), setApplicationMenu: jest.fn() },
  shell: { openExternal: jest.fn() },
  BrowserWindow: jest.fn(),
}));
jest.mock('electron-log', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock('../main/store', () => ({
  __esModule: true,
  default: {
    get: (k: string) => mockStore.get(k),
    set: (k: string, v: unknown) => mockStore.set(k, v),
  },
}));

const showMessageBox = dialog.showMessageBoxSync as jest.Mock;
const showSaveDialog = dialog.showSaveDialogSync as jest.Mock;
const showOpenDialog = dialog.showOpenDialogSync as jest.Mock;
const buildFromTemplate = Menu.buildFromTemplate as jest.Mock;

const makeWindow = () => ({
  webContents: {
    send: jest.fn(),
    on: jest.fn(),
    reload: jest.fn(),
    toggleDevTools: jest.fn(),
    inspectElement: jest.fn(),
  },
  setDocumentEdited: jest.fn(),
  setRepresentedFilename: jest.fn(),
  setTitle: jest.fn(),
  isDestroyed: jest.fn(() => false),
  isFullScreen: jest.fn(() => false),
  setFullScreen: jest.fn(),
  close: jest.fn(),
});
type FakeWindow = ReturnType<typeof makeWindow>;
const asWindow = (w: FakeWindow) => w as never;

const history = [
  { inserted: 'zq', front: 0, end: 0, t: '2020-01-01T00:00:00.000Z' },
];
const goodFile = (text = '<p>zq</p>') =>
  `midstVersion: 1\n${JSON.stringify({ text, history })}`;

let dir: string;
const pendingIo: Promise<void>[] = [];

// Run the real fs call, and record when its callback has run so a test can wait on it exactly.
const trackFsCallback = (name: 'readFile' | 'writeFile') => {
  const real = fs[name] as unknown as jest.Mock;
  jest.spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1] as jest.Mock;
    pendingIo.push(
      new Promise<void>((resolve) => {
        args[args.length - 1] = (...cbArgs: unknown[]) => {
          try {
            cb(...cbArgs);
          } finally {
            resolve();
          }
        };
      })
    );
    real(...args);
  }) as never);
};
const ioDone = async () => {
  await Promise.all(pendingIo.splice(0));
};

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  pendingIo.length = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-test-'));
  trackFsCallback('readFile');
  trackFsCallback('writeFile');
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const readBack = (p: string) => fs.readFileSync(p, 'utf8');
const dirListing = () => fs.readdirSync(dir).sort();

const seedDocument = (over: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    poem: '<p>xv</p>',
    history: JSON.stringify(history),
    meta: '',
    edited: 'true',
    ...over,
  };
  Object.entries(values).forEach(([k, v]) => mockStore.set(k, v));
};

describe('save', () => {
  it('writes the stored document, with the version line, to the stored filename', async () => {
    const target = path.join(dir, 'zq.midst');
    seedDocument({ filename: target });
    const win = makeWindow();
    await save(asWindow(win), false);
    await ioDone();
    expect(readBack(target)).toBe(
      `midstVersion: 1\n${JSON.stringify({ text: '<p>xv</p>', history })}`
    );
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('writes meta back unchanged when the document has it', async () => {
    const target = path.join(dir, 'zq.midst');
    seedDocument({
      filename: target,
      meta: JSON.stringify({ fontSize: 3, unknownKey: 'xv' }),
    });
    await save(asWindow(makeWindow()), false);
    await ioDone();
    expect(JSON.parse(readBack(target).split('\n')[1]).meta).toEqual({
      fontSize: 3,
      unknownKey: 'xv',
    });
  });

  it('marks the document saved and tells the renderer the bare file name', async () => {
    const target = path.join(dir, 'zq.midst');
    seedDocument({ filename: target });
    const win = makeWindow();
    await save(asWindow(win), false);
    await ioDone();
    expect(mockStore.get('edited')).toBe('false');
    expect(mockStore.get('filename')).toBe(target);
    expect(mockStore.get('baseFilename')).toBe('zq.midst');
    expect(win.setTitle).toHaveBeenCalledWith(target);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'set-filename',
      'zq.midst'
    );
  });

  it('on macOS clears the edited dot and sets the represented file', async () => {
    const target = path.join(dir, 'zq.midst');
    seedDocument({ filename: target });
    const win = makeWindow();
    await save(asWindow(win), true);
    await ioDone();
    expect(win.setDocumentEdited).toHaveBeenCalledWith(false);
    expect(win.setRepresentedFilename).toHaveBeenCalledWith(target);
  });

  it('elsewhere leaves the macOS-only window calls alone', async () => {
    seedDocument({ filename: path.join(dir, 'zq.midst') });
    const win = makeWindow();
    await save(asWindow(win), false);
    await ioDone();
    expect(win.setDocumentEdited).not.toHaveBeenCalled();
    expect(win.setRepresentedFilename).not.toHaveBeenCalled();
  });

  it('asks where to save a document that has no file yet, and saves there', async () => {
    const target = path.join(dir, 'xv.midst');
    seedDocument({ filename: '' });
    showSaveDialog.mockReturnValue(target);
    await save(asWindow(makeWindow()), false);
    await ioDone();
    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(showSaveDialog.mock.calls[0][1].filters).toEqual([
      { name: 'Midst', extensions: ['midst'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    expect(readBack(target)).toContain('"text":"<p>xv</p>"');
    expect(mockStore.get('filename')).toBe(target);
  });

  it('when the poet cancels the dialog, writes nothing, keeps the edited state and says so', async () => {
    seedDocument({ filename: '' });
    showSaveDialog.mockReturnValue(undefined);
    const win = makeWindow();
    await save(asWindow(win), false);
    expect(dirListing()).toEqual([]);
    expect(mockStore.get('edited')).toBe('true');
    expect(mockStore.get('filename')).toBe('');
    expect(win.webContents.send).toHaveBeenCalledWith('cancel-save');
    expect(win.webContents.send).not.toHaveBeenCalledWith(
      'set-filename',
      expect.anything()
    );
  });
});

describe('saveAs', () => {
  it('always asks, writes to the chosen file and leaves the previous file untouched', async () => {
    const previous = path.join(dir, 'zq.midst');
    const chosen = path.join(dir, 'xv.midst');
    fs.writeFileSync(previous, 'earlier work');
    seedDocument({ filename: previous });
    showSaveDialog.mockReturnValue(chosen);
    const win = makeWindow();
    await saveAs(asWindow(win), false);
    await ioDone();
    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(readBack(previous)).toBe('earlier work');
    expect(readBack(chosen)).toBe(
      `midstVersion: 1\n${JSON.stringify({ text: '<p>xv</p>', history })}`
    );
    expect(mockStore.get('filename')).toBe(chosen);
    expect(mockStore.get('baseFilename')).toBe('xv.midst');
    expect(mockStore.get('edited')).toBe('false');
    expect(win.webContents.send).toHaveBeenCalledWith(
      'set-filename',
      'xv.midst'
    );
    expect(win.setTitle).toHaveBeenCalledWith(chosen);
  });

  it('writes meta back unchanged', async () => {
    const chosen = path.join(dir, 'xv.midst');
    seedDocument({ meta: JSON.stringify({ title: 'zq' }) });
    showSaveDialog.mockReturnValue(chosen);
    await saveAs(asWindow(makeWindow()), false);
    await ioDone();
    expect(JSON.parse(readBack(chosen).split('\n')[1]).meta).toEqual({
      title: 'zq',
    });
  });

  it('on macOS clears the edited dot and sets the represented file', async () => {
    const chosen = path.join(dir, 'xv.midst');
    seedDocument();
    showSaveDialog.mockReturnValue(chosen);
    const win = makeWindow();
    await saveAs(asWindow(win), true);
    await ioDone();
    expect(win.setDocumentEdited).toHaveBeenCalledWith(false);
    expect(win.setRepresentedFilename).toHaveBeenCalledWith(chosen);
  });

  it('elsewhere leaves the macOS-only window calls alone', async () => {
    showSaveDialog.mockReturnValue(path.join(dir, 'xv.midst'));
    seedDocument();
    const win = makeWindow();
    await saveAs(asWindow(win), false);
    await ioDone();
    expect(win.setDocumentEdited).not.toHaveBeenCalled();
  });

  it('when the poet cancels, changes nothing', async () => {
    const previous = path.join(dir, 'zq.midst');
    seedDocument({ filename: previous });
    showSaveDialog.mockReturnValue(undefined);
    const win = makeWindow();
    await saveAs(asWindow(win), false);
    expect(dirListing()).toEqual([]);
    expect(mockStore.get('filename')).toBe(previous);
    expect(mockStore.get('edited')).toBe('true');
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(win.setTitle).not.toHaveBeenCalled();
  });
});

describe('newFile', () => {
  it('with unsaved changes, warns with Proceed/Cancel, defaulting to Proceed', () => {
    seedDocument({ edited: 'true' });
    showMessageBox.mockReturnValue(1);
    newFile(asWindow(makeWindow()), false);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    const options = showMessageBox.mock.calls[0][1];
    expect(options.buttons).toEqual(['Proceed', 'Cancel']);
    expect(options.defaultId).toBe(0);
    expect(options.cancelId).toBe(1);
    expect(options.type).toBe('warning');
  });

  it('when the poet cancels, keeps the document and tells the renderer nothing', () => {
    seedDocument({ edited: 'true', filename: '/x/zq.midst' });
    showMessageBox.mockReturnValue(1);
    const win = makeWindow();
    newFile(asWindow(win), true);
    expect(mockStore.get('poem')).toBe('<p>xv</p>');
    expect(mockStore.get('filename')).toBe('/x/zq.midst');
    expect(mockStore.get('edited')).toBe('true');
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(win.setTitle).not.toHaveBeenCalled();
  });

  it('when the poet proceeds, clears the document and tells the renderer', () => {
    seedDocument({
      edited: 'true',
      filename: '/x/zq.midst',
      baseFilename: 'zq.midst',
      meta: '{"a":1}',
    });
    showMessageBox.mockReturnValue(0);
    const win = makeWindow();
    newFile(asWindow(win), false);
    expect(mockStore.get('poem')).toBe('');
    expect(mockStore.get('history')).toBe('[]');
    expect(mockStore.get('meta')).toBe('');
    expect(mockStore.get('filename')).toBe('');
    expect(mockStore.get('baseFilename')).toBe('');
    expect(mockStore.get('edited')).toBe('false');
    expect(win.webContents.send).toHaveBeenCalledWith('open-file', '', [], '');
  });

  it('with no unsaved changes, does not ask', () => {
    seedDocument({ edited: 'false' });
    const win = makeWindow();
    newFile(asWindow(win), false);
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(mockStore.get('poem')).toBe('');
    expect(win.webContents.send).toHaveBeenCalledWith('open-file', '', [], '');
  });

  it('on macOS, titles the window Untitled; elsewhere does not', () => {
    seedDocument({ edited: 'false' });
    const mac = makeWindow();
    newFile(asWindow(mac), true);
    expect(mac.setTitle).toHaveBeenCalledWith('Untitled');
    expect(mac.setRepresentedFilename).toHaveBeenCalledWith('Untitled');
    const other = makeWindow();
    newFile(asWindow(other), false);
    expect(other.setTitle).not.toHaveBeenCalled();
  });
});

describe('openFile', () => {
  it('with unsaved changes and a Cancel, opens nothing and does not even ask for a file', async () => {
    seedDocument({ edited: 'true' });
    showMessageBox.mockReturnValue(1);
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, goodFile());
    await openFile(asWindow(makeWindow()), false, [target]);
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(mockStore.get('poem')).toBe('<p>xv</p>');
    expect(pendingIo).toHaveLength(0);
  });

  it('loads a current-version file given up front, without a file dialog', async () => {
    seedDocument({ edited: 'false' });
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, goodFile('<p>zq</p>'));
    const win = makeWindow();
    await openFile(asWindow(win), false, [target]);
    await ioDone();
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(mockStore.get('poem')).toBe('<p>zq</p>');
    expect(mockStore.get('filename')).toBe(target);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'open-file',
      '<p>zq</p>',
      history,
      'zq.midst'
    );
  });

  it('asks which file to open, with the Midst filter, when none is given', async () => {
    seedDocument({ edited: 'false' });
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, goodFile());
    showOpenDialog.mockReturnValue([target]);
    await openFile(asWindow(makeWindow()), false);
    await ioDone();
    expect(showOpenDialog.mock.calls[0][1].filters[0]).toEqual({
      name: 'Midst',
      extensions: ['midst'],
    });
    expect(mockStore.get('filename')).toBe(target);
  });

  it('when the poet cancels the open dialog, reads nothing and changes nothing', async () => {
    seedDocument({ edited: 'false', filename: '/x/zq.midst' });
    showOpenDialog.mockReturnValue(undefined);
    const win = makeWindow();
    await openFile(asWindow(win), false);
    expect(pendingIo).toHaveLength(0);
    expect(mockStore.get('filename')).toBe('/x/zq.midst');
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('treats an empty selection like a cancel', async () => {
    seedDocument({ edited: 'false' });
    showOpenDialog.mockReturnValue([]);
    await openFile(asWindow(makeWindow()), false);
    expect(pendingIo).toHaveLength(0);
    expect(mockStore.get('poem')).toBe('<p>xv</p>');
  });

  it('on macOS, clears the edited dot for the opened file', async () => {
    seedDocument({ edited: 'false' });
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, goodFile());
    const win = makeWindow();
    await openFile(asWindow(win), true, [target]);
    await ioDone();
    expect(win.setDocumentEdited).toHaveBeenCalledWith(false);
    expect(win.setRepresentedFilename).toHaveBeenCalledWith('zq.midst');
  });

  it('a file of the current version that cannot be parsed shows an error and leaves the open document alone', async () => {
    seedDocument({ edited: 'false', filename: '/x/xv.midst' });
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, 'midstVersion: 1\n{not json');
    const win = makeWindow();
    await openFile(asWindow(win), false, [target]);
    await ioDone();
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    const options = showMessageBox.mock.calls[0][1];
    expect(options.type).toBe('error');
    expect(options.message).toContain(target);
    expect(mockStore.get('poem')).toBe('<p>xv</p>');
    expect(mockStore.get('filename')).toBe('/x/xv.midst');
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  describe('a file of an older version', () => {
    const oldFile = JSON.stringify({
      editorTimelineFrames: [
        { content: '<p>zq</p>', lineNumber: '0', timestamp: 1000 },
      ],
    });

    it('offers Cancel or Convert File, defaulting to Convert', async () => {
      seedDocument({ edited: 'false' });
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, oldFile);
      showMessageBox.mockReturnValue(0);
      await openFile(asWindow(makeWindow()), false, [target]);
      await ioDone();
      const options = showMessageBox.mock.calls[0][1];
      expect(options.buttons).toEqual(['Cancel', 'Convert File']);
      expect(options.defaultId).toBe(1);
      expect(options.cancelId).toBe(0);
    });

    it('on Cancel, writes nothing, loads nothing and leaves the original as it was', async () => {
      seedDocument({ edited: 'false' });
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, oldFile);
      showMessageBox.mockReturnValue(0);
      const win = makeWindow();
      await openFile(asWindow(win), false, [target]);
      await ioDone();
      expect(dirListing()).toEqual(['zq.midst']);
      expect(readBack(target)).toBe(oldFile);
      expect(mockStore.get('poem')).toBe('<p>xv</p>');
      expect(app.addRecentDocument).not.toHaveBeenCalled();
      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('on Convert, writes a new file beside the original, loads it, and keeps the original', async () => {
      seedDocument({ edited: 'false' });
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, oldFile);
      showMessageBox.mockReturnValue(1);
      const win = makeWindow();
      await openFile(asWindow(win), false, [target]);
      await ioDone();
      const converted = path.join(dir, 'zq-converted.midst');
      expect(dirListing()).toEqual(['zq-converted.midst', 'zq.midst']);
      expect(readBack(target)).toBe(oldFile);
      const body = JSON.parse(readBack(converted).split('\n')[1]);
      expect(readBack(converted).startsWith('midstVersion: 1\n')).toBe(true);
      expect(body.text).toBe('<p>zq</p>');
      expect(app.addRecentDocument).toHaveBeenCalledWith(converted);
      expect(mockStore.get('filename')).toBe(converted);
      expect(win.webContents.send).toHaveBeenCalledWith(
        'open-file',
        '<p>zq</p>',
        body.history,
        'zq-converted.midst'
      );
    });

    it('on Convert, never overwrites an earlier converted file', async () => {
      seedDocument({ edited: 'false' });
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, oldFile);
      fs.writeFileSync(path.join(dir, 'zq-converted.midst'), 'months of work');
      showMessageBox.mockReturnValue(1);
      await openFile(asWindow(makeWindow()), false, [target]);
      await ioDone();
      expect(readBack(path.join(dir, 'zq-converted.midst'))).toBe(
        'months of work'
      );
      expect(readBack(path.join(dir, 'zq-converted-2.midst'))).toContain(
        '"text":"<p>zq</p>"'
      );
      expect(mockStore.get('filename')).toBe(
        path.join(dir, 'zq-converted-2.midst')
      );
    });
  });
});

describe('the menu', () => {
  type Item = {
    id?: string;
    label?: string;
    accelerator?: string;
    enabled?: boolean;
    click?: () => unknown;
    submenu?: Item[];
  };
  const realPlatform = process.platform;
  const realNodeEnv = process.env.NODE_ENV;
  const realDebugProd = process.env.DEBUG_PROD;

  const setPlatform = (p: string) =>
    Object.defineProperty(process, 'platform', { value: p });

  beforeEach(() => {
    buildFromTemplate.mockImplementation(() => ({ popup: jest.fn() }));
  });
  afterEach(() => {
    setPlatform(realPlatform);
    process.env.NODE_ENV = realNodeEnv;
    if (realDebugProd === undefined) delete process.env.DEBUG_PROD;
    else process.env.DEBUG_PROD = realDebugProd;
  });

  const find = (items: Item[], label: string): Item => {
    const hit = items.find((i) => i.label === label);
    if (!hit) throw new Error(`no menu item ${label}`);
    return hit;
  };
  const sub = (template: Item[], top: string, label: string) =>
    find(find(template, top).submenu!, label);
  const build = (platform: string, win = makeWindow()) => {
    setPlatform(platform);
    new MenuBuilder(asWindow(win)).buildMenu();
    return buildFromTemplate.mock.calls[0][0] as Item[];
  };

  describe('buildMenu', () => {
    it('builds the macOS template on darwin, installs it and returns the menu', () => {
      setPlatform('darwin');
      const built = { popup: jest.fn() };
      buildFromTemplate.mockReturnValue(built);
      const menu = new MenuBuilder(asWindow(makeWindow())).buildMenu();
      const labels = (buildFromTemplate.mock.calls[0][0] as Item[]).map(
        (i) => i.label
      );
      expect(labels).toEqual([
        'Midst',
        'File',
        'Edit',
        'View',
        'Window',
        'Help',
      ]);
      expect(Menu.setApplicationMenu).toHaveBeenCalledWith(built);
      expect(menu).toBe(built);
    });

    it('builds the default template elsewhere', () => {
      const template = build('linux');
      expect(template.map((i) => i.label)).toEqual([
        '&File',
        '&Edit',
        '&View',
        'Help',
      ]);
    });

    it('in development, wires the inspect-element context menu; in production it does not', () => {
      process.env.NODE_ENV = 'development';
      const dev = makeWindow();
      build('linux', dev);
      expect(dev.webContents.on).toHaveBeenCalledWith(
        'context-menu',
        expect.any(Function)
      );
      jest.clearAllMocks();
      buildFromTemplate.mockImplementation(() => ({ popup: jest.fn() }));
      process.env.NODE_ENV = 'production';
      delete process.env.DEBUG_PROD;
      const prod = makeWindow();
      build('linux', prod);
      expect(prod.webContents.on).not.toHaveBeenCalled();
    });

    it('DEBUG_PROD=true also wires the context menu', () => {
      process.env.NODE_ENV = 'production';
      process.env.DEBUG_PROD = 'true';
      const win = makeWindow();
      build('linux', win);
      expect(win.webContents.on).toHaveBeenCalled();
    });

    it('the context menu pops up in the window and inspects the clicked point', () => {
      process.env.NODE_ENV = 'development';
      const win = makeWindow();
      build('linux', win);
      const handler = win.webContents.on.mock.calls[0][1] as jest.Mock;
      const popup = jest.fn();
      buildFromTemplate.mockReturnValueOnce({ popup });
      handler({}, { x: 7, y: 9 });
      const contextTemplate = buildFromTemplate.mock.calls.at(-1)![0] as Item[];
      expect(contextTemplate).toHaveLength(1);
      expect(popup).toHaveBeenCalledWith({ window: win });
      contextTemplate[0].click!();
      expect(win.webContents.inspectElement).toHaveBeenCalledWith(7, 9);
    });
  });

  describe.each([
    ['darwin', true],
    ['linux', false],
  ])('on %s', (platform, isMac) => {
    const fileLabels = isMac
      ? {
          top: 'File',
          save: 'Save',
          saveAs: 'Save As',
          nw: 'New',
          open: 'Open',
        }
      : {
          top: '&File',
          save: '&Save',
          saveAs: '&Save As',
          nw: '&New',
          open: '&Open',
        };
    const editTop = isMac ? 'Edit' : '&Edit';
    const viewTop = isMac ? 'View' : '&View';
    const helpTop = 'Help';
    const fullScreenLabel = isMac
      ? 'Toggle Full Screen'
      : 'Toggle &Full Screen';

    it('Save and Save As start disabled and carry the ids the renderer enables', () => {
      const template = build(platform);
      const saveItem = sub(template, fileLabels.top, fileLabels.save);
      const saveAsItem = sub(template, fileLabels.top, fileLabels.saveAs);
      expect(saveItem).toMatchObject({ id: 'save', enabled: false });
      expect(saveAsItem).toMatchObject({ id: 'save-as', enabled: false });
    });

    it('Save saves the document', async () => {
      const target = path.join(dir, 'zq.midst');
      seedDocument({ filename: target });
      const win = makeWindow();
      const item = sub(build(platform, win), fileLabels.top, fileLabels.save);
      await item.click!();
      await ioDone();
      expect(readBack(target)).toContain('"text":"<p>xv</p>"');
      expect(win.setDocumentEdited).toHaveBeenCalledTimes(isMac ? 1 : 0);
    });

    // The document already has a file, so plain Save would write there without asking. Save As
    // must ask anyway and leave that file alone.
    it('Save As asks for a file and writes there', async () => {
      const current = path.join(dir, 'zq.midst');
      const chosen = path.join(dir, 'xv.midst');
      seedDocument({ filename: current });
      showSaveDialog.mockReturnValue(chosen);
      const item = sub(build(platform), fileLabels.top, fileLabels.saveAs);
      await item.click!();
      await ioDone();
      expect(showSaveDialog).toHaveBeenCalledTimes(1);
      expect(readBack(chosen)).toContain('"text":"<p>xv</p>"');
      expect(fs.existsSync(current)).toBe(false);
    });

    it('New guards unsaved changes before clearing the document', () => {
      seedDocument({ edited: 'true' });
      showMessageBox.mockReturnValue(1);
      const win = makeWindow();
      sub(build(platform, win), fileLabels.top, fileLabels.nw).click!();
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(mockStore.get('poem')).toBe('<p>xv</p>');
      showMessageBox.mockReturnValue(0);
      sub(buildFromTemplate.mock.calls[0][0], fileLabels.top, fileLabels.nw)
        .click!();
      expect(mockStore.get('poem')).toBe('');
    });

    it('Open guards unsaved changes, then opens the chosen file', async () => {
      const target = path.join(dir, 'zq.midst');
      fs.writeFileSync(target, goodFile('<p>zq</p>'));
      seedDocument({ edited: 'true' });
      showMessageBox.mockReturnValue(0);
      showOpenDialog.mockReturnValue([target]);
      const item = sub(build(platform), fileLabels.top, fileLabels.open);
      await item.click!();
      await ioDone();
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(mockStore.get('poem')).toBe('<p>zq</p>');
    });

    it('Toggle Edit Mode and the spellcheck toggle message the renderer', () => {
      const win = makeWindow();
      const template = build(platform, win);
      sub(template, editTop, 'Toggle Edit Mode').click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith('toggle-edit-mode');
      sub(
        template,
        editTop,
        isMac ? 'Show/hide spellcheck' : 'Toggle Spellcheck'
      ).click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith(
        'toggle-spellcheck'
      );
    });

    it('Toggle Full Screen flips the window state', () => {
      const win = makeWindow();
      const item = sub(build(platform, win), viewTop, fullScreenLabel);
      item.click!();
      expect(win.setFullScreen).toHaveBeenLastCalledWith(true);
      win.isFullScreen.mockReturnValue(true);
      item.click!();
      expect(win.setFullScreen).toHaveBeenLastCalledWith(false);
    });

    it('text size buttons step the stored size and tell the renderer', () => {
      const win = makeWindow();
      const template = build(platform, win);
      const inc = sub(template, viewTop, 'Increase text size');
      const dec = sub(template, viewTop, 'Decrease text size');
      inc.click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith(
        'set-font-size',
        '3'
      );
      expect(Number(mockStore.get('font-size'))).toBe(3);
      dec.click!();
      dec.click!();
      expect(win.webContents.send).toHaveBeenLastCalledWith(
        'set-font-size',
        '1'
      );
      expect(Number(mockStore.get('font-size'))).toBe(1);
    });

    it('Help links open the project pages in the browser', () => {
      const template = build(platform);
      sub(template, helpTop, 'Learn More').click!();
      expect(shell.openExternal).toHaveBeenLastCalledWith(
        'https://midst.press'
      );
      sub(template, helpTop, 'Documentation').click!();
      expect(shell.openExternal).toHaveBeenLastCalledWith(
        'https://github.com/jshafto/midst-app'
      );
    });

    it('production View menu has no Reload or Developer Tools', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DEBUG_PROD;
      const view = find(build(platform), viewTop).submenu!.map((i) => i.label);
      expect(view).not.toContain(isMac ? 'Reload' : '&Reload');
      expect(view.some((l) => l?.includes('Developer Tools'))).toBe(false);
    });

    it('development View menu reloads and toggles developer tools', () => {
      process.env.NODE_ENV = 'development';
      const win = makeWindow();
      const template = build(platform, win);
      sub(template, viewTop, isMac ? 'Reload' : '&Reload').click!();
      expect(win.webContents.reload).toHaveBeenCalledTimes(1);
      sub(
        template,
        viewTop,
        isMac ? 'Toggle Developer Tools' : 'Toggle &Developer Tools'
      ).click!();
      expect(win.webContents.toggleDevTools).toHaveBeenCalledTimes(1);
      const full = sub(template, viewTop, fullScreenLabel);
      full.click!();
      expect(win.setFullScreen).toHaveBeenCalledWith(true);
      sub(template, viewTop, 'Increase text size').click!();
      sub(template, viewTop, 'Decrease text size').click!();
      expect(win.webContents.send).toHaveBeenCalledWith('set-font-size', '3');
      expect(win.webContents.send).toHaveBeenCalledWith('set-font-size', '2');
    });
  });

  describe('font size limits', () => {
    it('Increase stops at 4', () => {
      mockStore.set('font-size', '4');
      const win = makeWindow();
      sub(build('linux', win), '&View', 'Increase text size').click!();
      expect(win.webContents.send).not.toHaveBeenCalled();
      expect(mockStore.get('font-size')).toBe('4');
    });

    it('Decrease stops at 0', () => {
      mockStore.set('font-size', '0');
      const win = makeWindow();
      sub(build('linux', win), '&View', 'Decrease text size').click!();
      expect(win.webContents.send).not.toHaveBeenCalled();
      expect(mockStore.get('font-size')).toBe('0');
    });

    it('Increase reaches 4 from the default of 2 and then stops', () => {
      const win = makeWindow();
      const inc = sub(build('linux', win), '&View', 'Increase text size');
      inc.click!();
      inc.click!();
      inc.click!();
      expect(win.webContents.send).toHaveBeenCalledTimes(2);
      expect(win.webContents.send).toHaveBeenLastCalledWith(
        'set-font-size',
        '4'
      );
    });
  });

  describe('macOS only', () => {
    it('Quit quits the app', () => {
      sub(build('darwin'), 'Midst', 'Quit').click!();
      expect(app.quit).toHaveBeenCalledTimes(1);
    });

    it('New on a destroyed window resets the stored document and reactivates the app', () => {
      // Saved state on purpose. A destroyed window with unsaved work should not arise (closing is
      // held until the poet chooses), so what New does about it is not pinned here.
      seedDocument({ edited: 'false', filename: '/x/zq.midst' });
      const win = makeWindow();
      win.isDestroyed.mockReturnValue(true);
      sub(build('darwin', win), 'File', 'New').click!();
      expect(mockStore.get('poem')).toBe('');
      expect(mockStore.get('history')).toBe('[]');
      expect(mockStore.get('meta')).toBe('');
      expect(mockStore.get('filename')).toBe('');
      expect(mockStore.get('edited')).toBe('false');
      expect(app.emit).toHaveBeenCalledWith('activate', false);
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('Windows and Linux only', () => {
    it('Close closes the window', () => {
      const win = makeWindow();
      sub(build('linux', win), '&File', '&Close').click!();
      expect(win.close).toHaveBeenCalledTimes(1);
    });
  });
});
