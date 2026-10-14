// The keyboard shortcut table of docs/user-guide.md, made from the menu templates of menu.ts so
// the guide cannot say one key while the menu has another (issue #99). Nothing here imports
// Electron: the functions take the templates as plain data.
//
// src/__tests__/userGuide.test.ts builds both templates, makes the table and compares it with
// the one in the guide.

export interface TemplateItem {
  label?: string;
  accelerator?: string;
  type?: string;
  submenu?: unknown;
}

export interface MenuEntry {
  menu: string;
  label: string;
  accelerator?: string;
}

// What each menu item does, in the guide's words, by the item's label. Two labels with the same
// words are one row of the table: the two platforms name the spellcheck item differently.
export const WHAT_IT_DOES: Record<string, string> = {
  New: 'Start a new poem',
  Open: 'Open a poem',
  Save: 'Save the poem',
  'Save As': 'Save the poem as a new file',
  Close: 'Close the window',
  Undo: 'Undo',
  Redo: 'Redo',
  Cut: 'Cut',
  Copy: 'Copy',
  Paste: 'Paste',
  'Select All': 'Select the whole poem',
  'Toggle Edit Mode': 'Switch between writing and Replay',
  'Show/hide spellcheck': 'Turn spellcheck on or off',
  'Toggle Spellcheck': 'Turn spellcheck on or off',
  'Toggle Full Screen': 'Fill the screen with Midst, or stop',
  'Increase text size': 'Make the text larger',
  'Decrease text size': 'Make the text smaller',
  Minimize: 'Put the window away in the Dock',
  'Hide Midst': 'Hide Midst',
  'Hide Others': 'Hide every other app',
  Quit: 'Quit Midst',
};

// Windows and Linux menus mark the letter to press with Alt as "&File". The guide shows the name.
const plain = (label: string) => label.replace(/&/g, '');

/** Every item of a menu template that has a label, with the menu it is in. Separators are left out. */
export function menuEntries(template: TemplateItem[]): MenuEntry[] {
  const entries: MenuEntry[] = [];
  template.forEach((menu) => {
    const items = Array.isArray(menu.submenu)
      ? (menu.submenu as TemplateItem[])
      : [];
    items.forEach((item) => {
      if (!item.label) return;
      entries.push({
        menu: plain(menu.label ?? ''),
        label: plain(item.label),
        accelerator: item.accelerator,
      });
    });
  });
  return entries;
}

const MAC_NAMES: Record<string, string> = {
  command: 'Command',
  cmd: 'Command',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Option',
  option: 'Option',
  shift: 'Shift',
};
const OTHER_NAMES: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
};
// Command first, so the two platforms read alike: Command+Shift+S beside Ctrl+Shift+S.
const MAC_ORDER = ['Command', 'Control', 'Option', 'Shift'];
const OTHER_ORDER = ['Ctrl', 'Alt', 'Shift'];

/**
 * An accelerator as the guide writes it: the names on the keys, joined with +, the modifier keys
 * first and always in the same order. "Command+S+Shift" becomes "Command+Shift+S".
 */
export function keysFor(accelerator: string, mac: boolean): string {
  const names = mac ? MAC_NAMES : OTHER_NAMES;
  const order = mac ? MAC_ORDER : OTHER_ORDER;
  const modifiers: string[] = [];
  const keys: string[] = [];
  accelerator.split('+').forEach((part) => {
    const modifier = names[part.toLowerCase()];
    if (modifier) modifiers.push(modifier);
    else keys.push(part.length === 1 ? part.toUpperCase() : part);
  });
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...modifiers, ...keys].join('+');
}

export interface Row {
  what: string;
  mac: string[];
  other: string[];
  macWhere: string[];
  otherWhere: string[];
}

/**
 * One row for each thing a shortcut does, in the order of the macOS menus, then anything only the
 * other menus have. Throws, naming the item, when a shortcut has no words in WHAT_IT_DOES.
 */
export function shortcutRows(
  macTemplate: TemplateItem[],
  otherTemplate: TemplateItem[]
): Row[] {
  const rows: Row[] = [];
  const add = (entry: MenuEntry, mac: boolean) => {
    if (!entry.accelerator) return;
    const what = WHAT_IT_DOES[entry.label];
    if (!what)
      throw new Error(
        `The menu item "${entry.menu} > ${entry.label}" has a shortcut and no words in WHAT_IT_DOES (src/main/shortcutTable.ts).`
      );
    let row = rows.find((candidate) => candidate.what === what);
    if (!row) {
      row = { what, mac: [], other: [], macWhere: [], otherWhere: [] };
      rows.push(row);
    }
    (mac ? row.mac : row.other).push(keysFor(entry.accelerator, mac));
    (mac ? row.macWhere : row.otherWhere).push(
      `${entry.menu} > ${entry.label}`
    );
  };
  menuEntries(macTemplate).forEach((entry) => add(entry, true));
  menuEntries(otherTemplate).forEach((entry) => add(entry, false));
  return rows;
}

const where = (row: Row) => {
  const mac = row.macWhere.join(', ');
  const other = row.otherWhere.join(', ');
  if (mac === other) return mac;
  if (!other) return `${mac} (macOS only)`;
  if (!mac) return `${other} (Windows and Linux only)`;
  return `${mac} on macOS; ${other} on Windows and Linux`;
};

/**
 * The table as Markdown, with its columns padded as prettier pads them, so the formatter and this
 * function agree on every byte. A platform whose menus have no such shortcut shows a dash.
 */
export function shortcutTable(
  macTemplate: TemplateItem[],
  otherTemplate: TemplateItem[]
): string {
  const cells = [
    ['To do this', 'macOS', 'Windows and Linux', 'In the menus'],
    ...shortcutRows(macTemplate, otherTemplate).map((row) => [
      row.what,
      row.mac.join(', ') || '–',
      row.other.join(', ') || '–',
      where(row),
    ]),
  ];
  const widths = cells[0].map((_, column) =>
    Math.max(...cells.map((row) => row[column].length))
  );
  const line = (row: string[]) =>
    `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  const rule = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
  return [line(cells[0]), rule, ...cells.slice(1).map(line)].join('\n');
}

export const TABLE_START =
  '<!-- shortcuts:start. This table is made from src/main/menu.ts. Do not edit it by hand: run UPDATE_GUIDE=1 npx jest src/__tests__/userGuide.test.ts -->';
export const TABLE_END = '<!-- shortcuts:end -->';

/** The guide with the table between its two markers replaced. Throws when a marker is missing. */
export function withTable(guide: string, table: string): string {
  const start = guide.indexOf(TABLE_START);
  const end = guide.indexOf(TABLE_END);
  if (start === -1 || end === -1 || end < start)
    throw new Error(
      'docs/user-guide.md has lost its shortcuts:start or shortcuts:end marker.'
    );
  return `${guide.slice(0, start)}${TABLE_START}\n\n${table}\n\n${guide.slice(
    end
  )}`;
}
