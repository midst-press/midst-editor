# 0.4.0

- **A file that cannot be read says so.** Opening one from **File** > **Open**, from your recent
  documents, or by opening Midst with it, now tells you it could not be read. Before, Midst offered to
  convert it.
- **Replay stays paused when you pause it.** Pressing play on a poem's last frame starts it again from
  the beginning a moment later; pausing or leaving Replay in that moment no longer lets it start anyway.
- Under the hood: Replay, the editor's autosave, the menus, the window's setup and the font size each
  live in one place instead of several, guarded by new unit tests for the editor, Replay and the toolbar.
  An unused component and its dependency (dompurify) are gone.

# 0.3.0

- **Need Help?** on the opening screen opens the help on the Midst website. A beta of the editor
  (below 1.0.0, or a pre-release) opens the help on the beta site.
- **Midst has a user guide.** It goes through everything in the app: writing, saving, Replay, draft
  markers, spellcheck and every keyboard shortcut on each platform. Open it from **Help** >
  **Documentation**, or from the **User Guide** button in About Midst.
- **About Midst says which version you have**: the version, the commit it was built from and when
  that commit was made, with a Copy button for pasting into a report. It is in the Midst menu on a Mac
  and in the Help menu on Windows and Linux.
- **Switching spellcheck on or off keeps you in your poem**, where before it took you back to the opening
  screen, and it no longer loses the last second of typing.
- **Pressing Return on an "Unsaved changes" warning now keeps your poem.** The warning shown when you
  close the window, start a new poem or open another one used to have the button that discards the
  work as its default. The default is now Cancel.
- **If a poem cannot be saved, Midst now says so and keeps it marked as unsaved.** Before, a save that
  failed (a full disk, a folder you cannot write to, a drive that had gone away) looked like a save that
  worked, and closing the window afterwards discarded the poem without a warning. The message offers
  **Save As…** so you can put the poem somewhere else.
- **Midst now needs macOS 13 (Ventura) or later**, and Windows 10 or later. It runs on Electron 44,
  which receives security fixes; the Electron it used before had none since December 2023.
- **Open and Save start in the folder of the last poem you opened or saved**, or in Documents.
- Under the hood: Electron 44 and electron-builder 26.

# 0.2.1

- **The macOS installer puts Midst in Applications even when another copy of Midst is somewhere else
  on the Mac.** Before, it could update that other copy, report success, and leave Applications empty.
- **A new poem's save dialog offers `Untitled.midst`**, not the last file name used.
- **The app icon is the new artwork, and has no grey border on macOS 26.**
- **Clicking Replay straight after typing no longer leaves the last second of typing out of the saved
  file.** Before, those keystrokes were saved only when you came back to the editor.
- **You can mark a draft.** The bookmark button marks the poem as it is at that moment, while writing or
  while watching the replay, once a poem has more than 50 changes. Name it, rename it or delete it from
  the Drafts list in the replay; markers show on the timeline, and choosing one takes you to that moment.
- Under the hood: every macOS installer is installed and checked on a real Mac before it is released,
  and Electron is put in place for development on Node 26.

# 0.2.0

- **Old poems convert to the new format with their font, size, title and draft markers kept**, and the
  editor keeps that information when it opens and saves the file. Converting never replaces an existing
  file. A paragraph-ending line break and whitespace are handled as the old editor did.
- **Replay follows the writing gently**: it scrolls smoothly to each change, at a speed relative to the
  window. It no longer jumps on a slow frame, or glides in a collapsed view.
- **A new profile starts with no unsaved changes.**
- **Saving refuses when no poem is loaded** instead of writing an empty file over one on disk.
- **New and Open ask before discarding unsaved work** even when that state was not recorded.
- **The text-size setting reads the same in every part of the app**, including the smallest size.
- **Licence: AGPL-3.0-or-later** (was MIT; the earlier notice is kept in `LICENSE-MIT`).
- Under the hood: Jest 30 with coverage, Node 26, current GitHub Actions, installers built without
  third-party install scripts, and a latent edge case in comparing identical versions closed.

# 0.1.0

The first release built from midst-press/midst-editor (a hard fork of jshafto/midst-app at 0.0.5).

- **Opening a second poem no longer overwrites it with the first** (#12). This affected 0.0.5.
- **Autosave stores the latest keystroke**, not the one before it. A save that was pending when
  another poem opens is abandoned instead of landing in that poem.
- **The macOS installer is signed with a Developer ID and notarised by Apple**, so it opens without
  a Gatekeeper warning. It is built for Apple silicon only.
- **Linux**: an AppImage is built, and its window has an icon (#32).

# 0.0.1

Initial version
