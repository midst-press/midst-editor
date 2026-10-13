# 0.2.1

- **The macOS installer puts Midst in Applications even when another copy of Midst is somewhere else
  on the Mac.** Before, it could update that other copy, report success, and leave Applications empty.
- **A new poem's save dialog offers `Untitled.midst`**, not the last file name used.
- **The app icon is the new artwork, and has no grey border on macOS 26.**
- **Clicking Replay straight after typing no longer leaves the last second of typing out of the saved
  file.** Before, those keystrokes were saved only when you came back to the editor.
- **Switching spellcheck on or off keeps you in your poem**, where before it took you back to the opening
  screen, and it no longer loses the last second of typing.
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
