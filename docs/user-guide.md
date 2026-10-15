# Writing in Midst

Midst is a place to write a poem and keep the whole of its making. While you write, Midst records every change: each word typed, moved and taken out, in the order you did it. That record is the poem's timelapse. You can watch it at any moment, and so can your readers when the poem is published.

This guide goes through everything in the app. Words in bold are the names you see on the screen.

## When Midst opens

You see a welcome and two buttons.

- **New File...** starts a new poem.
- **Open File...** opens a poem you have already started.

**Need Help?** under the buttons opens the Midst website.

## Starting a poem

Press **New File...**. Before you write anything, Midst asks where to keep the poem and what to call it. It asks first because it saves as you write. Choose a folder, type a name, and save.

If you close that question without choosing, Midst takes you back to the opening screen.

A Midst poem is one file, and its name ends in `.midst`. The file holds the poem and its timelapse together.

## The writing window

- **At the top** is the name of the poem's file.
- **At the top right** are four buttons: **Increase text size**, **Decrease text size**, **Bold** and **Italic**.
- **The page** fills the middle. Click in it and write.
- **At the bottom right** are two buttons: **Mark this moment as a draft** (a bookmark with a plus sign) and **Replay** (a clock with an arrow around it).

Rest your pointer on any button for a moment and its name appears.

The menus are at the top of the screen on a Mac, and at the top of the window on Windows and Linux.

## Writing

To make part of a line bold or italic, select the words, then press **Bold** or **Italic**. Press the same button again to take it off.

To indent, press Tab.

To make the text larger or smaller, press **Increase text size** or **Decrease text size**. There are five sizes. This changes how the poem looks on your screen. It does not change the poem, and Midst remembers the size you chose.

Everything you do goes into the timelapse, including what you undo.

## Saving

Midst saves the poem for you, one second after you stop typing. You do not need to do anything.

To save at once, choose **File** > **Save**. To keep a second copy under another name and carry on in that copy, choose **File** > **Save As**.

If Midst cannot save, it tells you in a message called **Could not save**. Your poem stays open. Press **Save As…** in that message to save it somewhere else.

If you start a new poem, open another one or close the window while something is unsaved, Midst warns you. **Cancel** keeps your poem. **Proceed** goes on without saving it.

## Opening a poem

Choose **File** > **Open**, or press **Open File...** on the opening screen. The first time, Midst looks in your Documents folder. After that it looks in the folder of the last poem you opened or saved.

A poem made in an older version of Midst needs converting before it opens. Midst asks first. **Convert File** makes a new file beside the old one and opens the new one. The old file is not changed.

## Replay

To watch the poem being written, press **Replay**. To come back and write, press **Edit** (the pencil).

In Replay you cannot type. Watching does not change the poem.

**What you see**

- **The poem**, as it was at the moment you are looking at. When Replay opens, that is the poem as it is now.
- **At the top right**, **Increase text size** and **Decrease text size**.
- **Along the bottom**, from left to right: the play button, the timeline, **Mark this moment as a draft**, **Drafts** and **Edit**.

**To play the poem**, press the play button (a triangle). It turns into a pause button (two bars); press it to stop where you are. The page follows the place where you were writing.

When the poem reaches the end, it stops. Pressing play at the end starts again from the beginning.

**The timeline** is the line along the bottom. Its left end is the first thing you put on the page and its right end is the poem as it is now. The dot shows where you are. Drag the dot, or click anywhere on the line, to go to that moment. While you point at the dot or drag it, a small label shows the time and date you made that change.

## Draft markers

A draft marker names a moment in the poem's timelapse: the end of a first draft, the version you read aloud, the one you sent to a friend. You can go back to a marked moment whenever you like. When the poem is published, readers see your draft markers above the timeline and can go to them too.

You can mark a draft once the poem has more than 50 changes. Until then the button is grey.

**To mark the poem as it is now**, press **Mark this moment as a draft** in the writing window. Midst takes you to Replay and opens the **Drafts** list, with the new draft's name ready for you to type over.

**To mark an earlier moment**, go to Replay, move along the timeline to the moment, and press **Mark this moment as a draft**.

**To name the draft**, type the name and press Enter. If you do not type a name, Midst calls it Draft 1, Draft 2 and so on.

A moment can have one draft marker. At a moment that already has one, the button is grey.

### The Drafts list

Press **Drafts** in Replay to open the list. The newest draft is at the top.

- **To go to a draft**, click its name. The poem stops at that moment.
- **To rename a draft**, press **Rename draft** (the pencil beside it), type the new name and press Enter. Press Escape instead to keep the old name; that also closes the list. If you leave the name empty, Midst puts back Draft 1, Draft 2 and so on.
- **To delete a draft**, press **Delete draft** (the bin beside it). Midst deletes the marker at once and does not ask first. The poem and its timelapse are not touched; only the marker goes.

Two switches at the top of the list change what the timeline shows:

- **Show markers on the timeline** shows or hides the small mark at each draft's moment.
- **Show their names** shows or hides each draft's name above its mark.

To close the list, press Escape or click outside it.

### To play the poem from a draft

1. In Replay, press **Drafts**.
2. Click the draft's name.
3. Press Escape to close the list.
4. Press the play button, or press Space.

## Spellcheck

Spellcheck marks words it does not know. It is off until you turn it on.

To turn it on or off while you are writing, choose **Edit** > **Show/hide spellcheck** on a Mac, or **Edit** > **Toggle Spellcheck** on Windows and Linux. Midst remembers your choice.

## Full screen

To fill the whole screen with Midst, choose **View** > **Toggle Full Screen**. Choose it again to go back.

## Keyboard shortcuts

Each shortcut is written as the names on the keys, joined with +. Hold the first keys down and press the last.

<!-- shortcuts:start. This table is made from src/main/menu.ts. Do not edit it by hand: run UPDATE_GUIDE=1 npx jest src/__tests__/userGuide.test.ts -->

| To do this                          | macOS             | Windows and Linux | In the menus                                                                        |
| ----------------------------------- | ----------------- | ----------------- | ----------------------------------------------------------------------------------- |
| Hide Midst                          | Command+H         | –                 | Midst > Hide Midst (macOS only)                                                     |
| Hide every other app                | Command+Shift+H   | –                 | Midst > Hide Others (macOS only)                                                    |
| Quit Midst                          | Command+Q         | –                 | Midst > Quit (macOS only)                                                           |
| Start a new poem                    | Command+N         | Ctrl+N            | File > New                                                                          |
| Save the poem                       | Command+S         | Ctrl+S            | File > Save                                                                         |
| Save the poem as a new file         | Command+Shift+S   | Ctrl+Shift+S      | File > Save As                                                                      |
| Open a poem                         | Command+O         | Ctrl+O            | File > Open                                                                         |
| Undo                                | Command+Z         | Ctrl+Z            | Edit > Undo                                                                         |
| Redo                                | Command+Shift+Z   | Ctrl+Shift+Z      | Edit > Redo                                                                         |
| Cut                                 | Command+X         | Ctrl+X            | Edit > Cut                                                                          |
| Copy                                | Command+C         | Ctrl+C            | Edit > Copy                                                                         |
| Paste                               | Command+V         | Ctrl+V            | Edit > Paste                                                                        |
| Select the whole poem               | Command+A         | Ctrl+A            | Edit > Select All                                                                   |
| Switch between writing and Replay   | Command+T         | Ctrl+T            | Edit > Toggle Timeline                                                              |
| Turn spellcheck on or off           | Command+;         | Ctrl+;            | Edit > Show/hide spellcheck on macOS; Edit > Toggle Spellcheck on Windows and Linux |
| Fill the screen with Midst, or stop | Command+Control+F | F11               | View > Toggle Full Screen                                                           |
| Make the text larger                | Command+Shift+=   | Ctrl+=            | View > Increase text size                                                           |
| Make the text smaller               | Command+Shift+-   | Ctrl+-            | View > Decrease text size                                                           |
| Put the window away in the Dock     | Command+M         | –                 | Window > Minimize (macOS only)                                                      |
| Close the window                    | Command+W         | Ctrl+W            | Window > Close on macOS; File > Close on Windows and Linux                          |

<!-- shortcuts:end -->

Some keys are not in the menus:

- **While writing:** Tab indents. Command+B (Ctrl+B on Windows and Linux) makes the selected words bold. Command+I (Ctrl+I on Windows and Linux) makes them italic.
- **In Replay:** Space or Enter plays and pauses. Escape takes you back to writing.
- **In the Drafts list:** Enter keeps the name you typed. Escape closes the list, and keeps the old name if you were typing one.

## Which version of Midst do you have?

Choose **Midst** > **About Midst** on a Mac, or **Help** > **About Midst** on Windows and Linux. A small window shows one line, for example:

    Version v0.3.0-beta.1, commit a1b2c3d, committed 2026-10-13 20:30 UTC

If you write to us about a problem, press **Copy** and paste that line into your message. **User Guide** opens this guide. **OK** closes the window.

## More help

**Help** > **Documentation** opens this guide. **Help** > **Learn More** opens the Midst website.
