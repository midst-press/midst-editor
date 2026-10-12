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
- **Comparing two identical versions no longer erases the text.**
- **Licence: AGPL-3.0-or-later** (was MIT; the earlier notice is kept in `LICENSE-MIT`).
- Under the hood: Jest 30 with coverage, Node 26, current GitHub Actions, and installers built without
  third-party install scripts.

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
