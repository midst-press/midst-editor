# Current Issue Tracker

## User-facing

### Major Features

- [ ] integrate new replay logic into existing website
- [ ] allow user to restore the text from a point history
- [ ] revert history to a timepoint (permanently erasing all history of changes past that point)
- [ ] draft markers

### Minor Features

- [ ] change "toggle edit mode" to "toggle timeline" and change shortcut to command+t
- [ ] wait for scroll to finish before replay continues
- allow user to customize/change appearance
  - [ ] choose dark or light theme (blocked by refactoring styles)
  - [ ] the ability to select a display font
- [ ] turn autoscroll on and off
- [ ] allow user to adjust replay speed (website only, low priority)
- [ ] add a "quiet mode"
- [ ] export most recent frame to rich text file
- [ ] restore cursor to most recent position when you switch back from replay mode (and scroll to that position)
- [ ] search text
- [ ] toggle autosave off
- [ ] add an empty frame at the beginning of each poem
- [ ] additional rich text features (indentation, underline, strikethrough)

### Bugs

- [ ] whitespace
- [ ] when you switch back from replay mode, keep cursor position
- [ ] linux only: icon doesn't work

### Style

- [ ] obtain designer feedback on current design and create further items based on feedback

## Developer

### Tests

- [ ] manual testing to establish limits on text length
- [ ] expand automated testing by adding unit and integration tests

### Code changes/refactoring

- [ ] explore options for libraries that handle style/theme values
