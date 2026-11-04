import { reportChanges, untitledWithEdits } from '../main/untitledEdits';

// #421 (GitHub #113): which poems the title flags, and that the window is told only of changes.
describe('untitledWithEdits', () => {
  it('is true only for an edited poem with no file name', () => {
    expect(untitledWithEdits(true, '')).toBe(true);
    expect(untitledWithEdits(true, undefined)).toBe(true);
    expect(untitledWithEdits(false, '')).toBe(false);
    expect(untitledWithEdits(undefined, '')).toBe(false);
    // A named poem waiting for its autosave: no flag, or it would flash as the poet types.
    expect(untitledWithEdits(true, 'zq.midst')).toBe(false);
  });
});

describe('reportChanges', () => {
  it('says nothing for the answer it starts from, then each change once', () => {
    let answer = false;
    const said: boolean[] = [];
    const check = reportChanges(
      () => answer,
      (shown) => said.push(shown)
    );
    check();
    expect(said).toEqual([]);
    answer = true;
    check();
    check();
    answer = false;
    check();
    expect(said).toEqual([true, false]);
  });
});
