/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import {
  TABLE_END,
  TABLE_START,
  TemplateItem,
  keysFor,
  shortcutRows,
  shortcutTable,
  withTable,
} from '../main/shortcutTable';

// The user guide (issue #99) must say what the app says. Its shortcut table is made from the menu
// templates of menu.ts, and every name it prints in bold must be a name the app shows.

jest.mock('electron', () => ({
  app: {
    quit: jest.fn(),
    emit: jest.fn(),
    getPath: jest.fn(),
    getPreferredSystemLanguages: jest.fn(() => ['en']),
  },
  dialog: {},
  Menu: { buildFromTemplate: jest.fn(), setApplicationMenu: jest.fn() },
  shell: { openExternal: jest.fn() },
  BrowserWindow: jest.fn(),
  ipcMain: { on: jest.fn() },
}));
jest.mock('../main/about', () => ({ showAbout: jest.fn() }));
jest.mock('electron-log', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock('../main/store', () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn() },
}));

const root = path.join(__dirname, '../..');
const guidePath = path.join(root, 'docs/user-guide.md');

describe('keysFor', () => {
  it('puts the modifier keys first, in one order, whatever order the menu wrote them in', () => {
    expect(keysFor('Command+S+Shift', true)).toBe('Command+Shift+S');
    expect(keysFor('Shift+Command+Z', true)).toBe('Command+Shift+Z');
    expect(keysFor('Ctrl+Command+F', true)).toBe('Command+Control+F');
    expect(keysFor('Shift+Ctrl+Z', false)).toBe('Ctrl+Shift+Z');
  });

  it('names the keys as each platform prints them', () => {
    expect(keysFor('Alt+Command+I', true)).toBe('Command+Option+I');
    expect(keysFor('Alt+Ctrl+I', false)).toBe('Ctrl+Alt+I');
    expect(keysFor('F11', false)).toBe('F11');
    expect(keysFor('Command+;', true)).toBe('Command+;');
  });
});

describe('the shortcut table', () => {
  const sample = (
    id: string,
    label: string,
    accelerator?: string,
    menu = '&File'
  ): TemplateItem[] => [{ label: menu, submenu: [{ id, label, accelerator }] }];

  it('has one row for an item both platforms have, with each platform’s keys', () => {
    const table = shortcutTable(
      sample('menu.file.save', 'Save', 'Command+S', 'File'),
      sample('menu.file.save', '&Save', 'Ctrl+S')
    );
    expect(table.split('\n')[2]).toBe(
      '| Save the poem | Command+S | Ctrl+S            | File > Save  |'
    );
  });

  it('shows a dash, and says which platform, for an item only one has', () => {
    const table = shortcutTable(
      sample('menu.app.quit', 'Quit', 'Command+Q', 'Midst'),
      []
    );
    expect(table.split('\n')[2]).toBe(
      '| Quit Midst | Command+Q | –                 | Midst > Quit (macOS only) |'
    );
  });

  it('joins two labels for the same thing into one row and names both', () => {
    const table = shortcutTable(
      sample(
        'menu.edit.spellcheck.mac',
        'Show/hide spellcheck',
        'Command+;',
        'Edit'
      ),
      sample(
        'menu.edit.spellcheck.other',
        'Toggle Spellcheck',
        'Ctrl+;',
        '&Edit'
      )
    );
    expect(table.split('\n')).toHaveLength(3);
    expect(table).toContain(
      'Edit > Show/hide spellcheck on macOS; Edit > Toggle Spellcheck on Windows and Linux'
    );
  });

  it('leaves out items with no shortcut, and separators', () => {
    expect(
      shortcutRows(
        [
          {
            label: 'Help',
            submenu: [{ label: 'Learn More' }, { type: 'separator' }],
          },
        ],
        []
      )
    ).toEqual([]);
  });

  it('refuses a shortcut that has no words, naming the item', () => {
    expect(() =>
      shortcutTable(sample('menu.zq', 'Zq', 'Command+J', 'File'), [])
    ).toThrow('File > Zq');
    // An id that is an Object.prototype name is not words either.
    expect(() =>
      shortcutTable(sample('toString', 'Zq', 'Command+J', 'File'), [])
    ).toThrow('File > Zq');
  });

  // #210: the table goes between its two markers, and a guide that has lost either is refused.
  it('puts the table between the markers, keeping the guide either side', () => {
    expect(withTable(`zq\n${TABLE_START}\nold\n${TABLE_END}\nxv`, 'new')).toBe(
      `zq\n${TABLE_START}\n\nnew\n\n${TABLE_END}\nxv`
    );
  });

  it.each([
    ['the start marker', `zq\nold\n${TABLE_END}\nxv`],
    ['the end marker', `zq\n${TABLE_START}\nold\nxv`],
    ['the markers’ order', `zq\n${TABLE_END}\nold\n${TABLE_START}\nxv`],
  ])('refuses a guide that has lost %s', (_name, guide) => {
    expect(() => withTable(guide, 'new')).toThrow(
      'docs/user-guide.md has lost its shortcuts:start or shortcuts:end marker.'
    );
  });
});

// #99 (Stuart, 21 Oct): the public guide is a placeholder until Annelyse writes the real one. The links to it stay; the
// tests of its content (the shortcut table, the names in bold, the window's buttons) went with that content, and the
// table's generator above keeps its own tests.
describe('the user guide', () => {
  it('is the Under Construction placeholder, with no shortcut table', () => {
    const guide = fs.readFileSync(guidePath, 'utf8');
    expect(guide).toContain('Under Construction');
    expect(guide).not.toContain(TABLE_START);
    expect(guide).not.toContain(TABLE_END);
  });
});
