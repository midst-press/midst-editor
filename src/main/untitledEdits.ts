// Annelyse, GitHub #113 (#421): an untitled poem with edits has changes autosave will not save, since it has no file
// of its own; autosave writes only its recovery copy. Its title says so. A named poem says nothing while it waits
// for its autosave, a second after typing stops, or the title would flash as the poet types.
export const untitledWithEdits = (
  edited: boolean | undefined,
  baseFilename: string | undefined
): boolean => edited === true && !baseFilename;

// Calls `say` with the new answer only when it changes, starting from the answer when it is made. The window reads
// the answer from the store when it loads, so it needs telling only of changes.
export const reportChanges = (
  answer: () => boolean,
  /* eslint-disable-next-line no-unused-vars -- the name says what the argument is */
  say: (shown: boolean) => void
): (() => void) => {
  let last = answer();
  return () => {
    const now = answer();
    if (now === last) return;
    last = now;
    say(now);
  };
};
