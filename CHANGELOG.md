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
