// The keyboard shortcut table of docs/user-guide.md, made from the menu templates of menu.ts so
// the guide cannot say one key while the menu has another (issue #99). Nothing here imports
// Electron: the functions take the templates as plain data.
//
// src/__tests__/userGuide.test.ts builds both templates, makes the table and compares it with
// the one in the guide.
import { i18n } from '../shared/i18n';

export interface TemplateItem {
  id?: string;
  label?: string;
  accelerator?: string;
  type?: string;
  submenu?: unknown;
}

export interface MenuEntry {
  id?: string;
  menu: string;
  label: string;
  accelerator?: string;
}

// What each menu item with a shortcut does, in the guide's words, by the item's id (its catalog key,
// menu.ts). Two items with the same words are one row of the table: the two platforms name the
// spellcheck item differently, and Close is in Window on macOS and File elsewhere. Each is a catalog call
// written out, so `lingui extract` sees every key.
export const WHAT_IT_DOES: Record<string, () => string> = {
  'menu.file.new': () => i18n._('menu.file.new.description'),
  'menu.file.open': () => i18n._('menu.file.open.description'),
  'menu.file.save': () => i18n._('menu.file.save.description'),
  'menu.file.saveAs': () => i18n._('menu.file.saveAs.description'),
  'menu.file.close': () => i18n._('menu.file.close.description'),
  'menu.window.close': () => i18n._('menu.window.close.description'),
  'menu.edit.undo': () => i18n._('menu.edit.undo.description'),
  'menu.edit.redo': () => i18n._('menu.edit.redo.description'),
  'menu.edit.cut': () => i18n._('menu.edit.cut.description'),
  'menu.edit.copy': () => i18n._('menu.edit.copy.description'),
  'menu.edit.paste': () => i18n._('menu.edit.paste.description'),
  'menu.edit.selectAll': () => i18n._('menu.edit.selectAll.description'),
  'menu.edit.toggleTimeline': () =>
    i18n._('menu.edit.toggleTimeline.description'),
  'menu.edit.find': () => i18n._('menu.edit.find.description'),
  'menu.edit.spellcheck.mac': () =>
    i18n._('menu.edit.spellcheck.mac.description'),
  'menu.edit.spellcheck.other': () =>
    i18n._('menu.edit.spellcheck.other.description'),
  'menu.view.fullScreen': () => i18n._('menu.view.fullScreen.description'),
  'menu.view.textSizeIncrease': () =>
    i18n._('menu.view.textSizeIncrease.description'),
  'menu.view.textSizeDecrease': () =>
    i18n._('menu.view.textSizeDecrease.description'),
  'menu.window.minimize': () => i18n._('menu.window.minimize.description'),
  'menu.app.hide': () => i18n._('menu.app.hide.description'),
  'menu.app.hideOthers': () => i18n._('menu.app.hideOthers.description'),
  'menu.app.quit': () => i18n._('menu.app.quit.description'),
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
        id: item.id,
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
    const describe =
      entry.id && Object.prototype.hasOwnProperty.call(WHAT_IT_DOES, entry.id)
        ? WHAT_IT_DOES[entry.id]
        : undefined;
    if (!describe)
      throw new Error(
        `The menu item "${entry.menu} > ${entry.label}" has a shortcut and no words in WHAT_IT_DOES (src/main/shortcutTable.ts).`
      );
    const what = describe();
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
  if (!other) return i18n._('guide.shortcuts.macOnly', { where: mac });
  if (!mac) return i18n._('guide.shortcuts.otherOnly', { where: other });
  return i18n._('guide.shortcuts.both', { mac, other });
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
    [
      i18n._('guide.shortcuts.what'),
      i18n._('guide.shortcuts.mac'),
      i18n._('guide.shortcuts.other'),
      i18n._('guide.shortcuts.where'),
    ],
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
