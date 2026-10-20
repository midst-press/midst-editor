// How the editor speaks to a poet after a save fails (#94). Every rule about telling them, and about telling them
// again, is in this file, so a different answer from Annelyse (GitHub midst-press/midst-editor#75) is a change here.
//
// A save is the poet's (they chose Save or Save As, or have just picked the file in a dialog) or one of the
// editor's own (on opening a document, a second after typing, on leaving for the replay). The rules:
//   - A save the poet chooses always says when it fails.
//   - The editor's own saves say nothing when nothing was unsaved: opening a read-only poem to read it is not a
//     failure worth a message.
//   - Otherwise they say so ONCE per file while it keeps failing. An autosave follows every pause in typing, and a
//     message after each one would make a poem in a read-only place impossible to work on.
//   - A document with no file whose first save failed is not given the save panel again by the editor's own saves:
//     it would open at every pause in typing. Save and Save As still ask where it goes, and closing the window
//     warns that the poem is unsaved.
//   - Until a save works, the window says the poem is not saved. On macOS the dot in the close button does that;
//     elsewhere the title does.
// A save that works, a new document and an opened one start again from nothing.

let told: string | undefined;
let firstSaveFailed = false;
let notSaved = false;

export type Failure = {
  filename: string;
  byPoet: boolean;
  // The document had no file when this save began: the poet was choosing one.
  firstSave: boolean;
  nothingUnsaved: boolean;
};

// Records the failure and says whether to tell the poet.
export const failed = ({
  filename,
  byPoet,
  firstSave,
  nothingUnsaved,
}: Failure): boolean => {
  if (!byPoet && nothingUnsaved) return false;
  notSaved = !nothingUnsaved;
  if (firstSave) firstSaveFailed = true;
  if (!byPoet && told === filename) return false;
  told = filename;
  return true;
};

// Whether a save of a document with no file may open the save panel.
export const mayAskWhereToSave = (byPoet: boolean): boolean =>
  byPoet || !firstSaveFailed;

// Whether the window should say the poem is not saved.
export const showsNotSaved = (): boolean => notSaved;

// A save worked, or the window holds another document.
export const startAgain = () => {
  told = undefined;
  firstSaveFailed = false;
  notSaved = false;
};
