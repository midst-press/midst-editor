/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import PO from 'pofile';
import MenuBuilder from '../main/menu';
import {
  TABLE_END,
  TABLE_START,
  TemplateItem,
  WHAT_IT_DOES,
  keysFor,
  menuEntries,
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

// The menus a poet has: the ones of a released app, not the development ones.
const templates = () => {
  const before = { env: process.env.NODE_ENV, debug: process.env.DEBUG_PROD };
  process.env.NODE_ENV = 'production';
  delete process.env.DEBUG_PROD;
  try {
    const builder = new MenuBuilder({} as never);
    return {
      mac: builder.buildDarwinTemplate() as TemplateItem[],
      other: builder.buildDefaultTemplate() as TemplateItem[],
    };
  } finally {
    process.env.NODE_ENV = before.env;
    if (before.debug !== undefined) process.env.DEBUG_PROD = before.debug;
  }
};

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

describe('the user guide', () => {
  const { mac, other } = templates();
  const guide = () => fs.readFileSync(guidePath, 'utf8');

  it('has the shortcut table the menus make', () => {
    const expected = withTable(guide(), shortcutTable(mac, other));
    if (process.env.UPDATE_GUIDE) fs.writeFileSync(guidePath, expected);
    expect(guide()).toBe(expected);
  });

  it('has every shortcut of both menus, with its keys', () => {
    const text = guide();
    const table = text.slice(
      text.indexOf(TABLE_START),
      text.indexOf(TABLE_END)
    );
    const check = (template: TemplateItem[], isMac: boolean) =>
      menuEntries(template)
        .filter((entry) => entry.accelerator)
        .forEach((entry) => {
          const row = table
            .split('\n')
            .find((line) => line.includes(`${entry.menu} > ${entry.label}`));
          expect(row).toBeDefined();
          const keys = row!.split('|')[isMac ? 2 : 3].split(', ');
          expect(keys.map((key) => key.trim())).toContain(
            keysFor(entry.accelerator!, isMac)
          );
        });
    check(mac, true);
    check(other, false);
    // And the menus do have shortcuts: an empty template would pass the loop above.
    expect(table.split('\n').length).toBeGreaterThan(20);
  });

  it('has no words for a menu item that is no longer in the menus', () => {
    const ids = new Set(
      [...menuEntries(mac), ...menuEntries(other)]
        .filter((entry) => entry.accelerator)
        .map((entry) => entry.id)
    );
    expect(Object.keys(WHAT_IT_DOES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('names every menu item that has no shortcut', () => {
    // Items macOS puts in every app's menus, which do nothing particular to Midst.
    const system = ['Services', 'Show All', 'Bring All to Front'];
    const text = guide();
    const unnamed = [...menuEntries(mac), ...menuEntries(other)]
      .filter((entry) => !entry.accelerator && !system.includes(entry.label))
      .filter((entry) => !text.includes(`**${entry.label}**`))
      .map((entry) => `${entry.menu} > ${entry.label}`);
    expect(unnamed).toEqual([]);
  });

  // Everything the app can show as text: the main process, the window and the English catalog.
  const sourceText = () => {
    const files: string[] = [];
    const walk = (dir: string) =>
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
      });
    walk(path.join(root, 'src/main'));
    walk(path.join(root, 'src/renderer'));
    // The words the app shows from the message catalog, which hold each one as a quoted msgstr.
    files.push(path.join(root, 'locales/en/messages.po'));
    return (
      files
        .map((file) => fs.readFileSync(file, 'utf8'))
        .join('\n')
        // "&File" is "File" with a letter marked for Alt; text inside tags may be on its own line.
        .replace(/&(?=\w)/g, '')
        .replace(/>\s+/g, '>')
        .replace(/\s+</g, '<')
    );
  };
  // Is `name` something the app shows: a quoted string, or the text of an element?
  const appShows = (source: string, name: string) =>
    [`'${name}'`, `"${name}"`, `>${name}<`].some((form) =>
      source.includes(form)
    );
  // The bold names in the guide's prose. A bold phrase that ends in a colon is a lead-in of the
  // guide's own ("**To play the poem**, ..." is not one, "**While writing:**" is), not a name.
  const boldNames = (text: string) => {
    const prose =
      text.slice(0, text.indexOf(TABLE_START)) +
      text.slice(text.indexOf(TABLE_END));
    const names = new Set<string>();
    const bold = /\*\*([^*]+)\*\*/g;
    for (let m = bold.exec(prose); m; m = bold.exec(prose)) names.add(m[1]);
    return Array.from(names);
  };
  // The guide's own bold lead-ins, which are not names on the screen.
  const LEAD_INS = [
    'At the top',
    'At the top right',
    'The page',
    'At the bottom right',
    'What you see',
    'The poem',
    'Along the bottom',
    'To play the poem',
    'The timeline',
    'To mark the poem as it is now',
    'To mark an earlier moment',
    'To name the draft',
    'To go to a draft',
    'To rename a draft',
    'To delete a draft',
    'To carry on from an earlier moment',
    'While writing:',
    'In Replay:',
    'In the Drafts list:',
  ];

  it('prints in bold only names the app shows', () => {
    const source = sourceText();
    const names = boldNames(guide()).filter((name) => !LEAD_INS.includes(name));
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((name) => !appShows(source, name))).toEqual([]);
  });

  it('has no lead-in listed that the guide no longer uses', () => {
    const used = boldNames(guide());
    expect(LEAD_INS.filter((name) => !used.includes(name))).toEqual([]);
  });

  // The English of each catalog key.
  const english = () =>
    new Map(
      PO.parse(
        fs.readFileSync(path.join(root, 'locales/en/messages.po'), 'utf8')
      ).items.map((item) => [item.msgid, item.msgstr[0]])
    );

  it('names every button of the window', () => {
    const source = sourceText();
    const words = english();
    const labels = new Set<string>();
    // Written out, or read from the catalog by key.
    const attribute = /aria-label=(?:"([^"]+)"|\{i18n\._\('([^']+)'\)\})/g;
    for (let m = attribute.exec(source); m; m = attribute.exec(source))
      labels.add(m[1] ?? (words.get(m[2]) as string));
    expect(labels.size).toBeGreaterThan(8);
    expect(labels.has(undefined as unknown as string)).toBe(false);
    // The field a draft's name is typed in is described, not named.
    labels.delete('Draft name');
    const text = guide();
    expect(
      Array.from(labels).filter((label) => !text.includes(`**${label}**`))
    ).toEqual([]);
  });
});
