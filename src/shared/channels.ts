import type { ChangeObj } from '@midst-press/midst-format/history';

// The messages between the main process and the window, and what each carries (#355). The preload's
// `on`, `once` and `sendMessage`, and main's `sendToWindow`, are typed by these maps, so a channel that is
// not here, or a payload of the wrong shape, does not compile.
//
// What crosses IPC is untyped whatever these say, so main's listeners still check what they receive.

/* eslint-disable no-unused-vars -- the labels in these tuples say what each payload is */
// Sent by main with webContents.send.
export interface MainToWindow {
  'open-file': [poem: string, history: ChangeObj[], filename: string];
  'set-filename': [filename: string];
  'step-font-size': [direction: 'up' | 'down'];
  'set-locale': [locale: string];
  'set-focus-mode': [on: boolean];
  'set-not-saved': [shown: boolean];
  'set-untitled-edited': [shown: boolean];
  'flush-editor': [id: number];
  'toggle-edit-mode': [];
  'toggle-spellcheck': [];
  'find-in-poem': [];
  'choose-font': [];
  'choose-colours': []; // View > Colours…, an audition build only (GitHub #119)
  'cancel-save': [];
}

// Sent by the window with sendMessage, as one array.
export interface WindowToMain {
  'set-language': [tag: string];
  'editor-flushed': [id: number];
  'save-file': [];
  'new-file': [];
  'button-open-file': [];
  'open-help': [];
  'enable-save': [];
  'disable-save': [];
  'focus-mode-requested': [];
  'focus-mode-changed': [];
}
/* eslint-enable no-unused-vars */
