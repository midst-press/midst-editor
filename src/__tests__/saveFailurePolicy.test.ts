import { failed, showsNotSaved, startAgain } from '../main/saveFailurePolicy';

// #94: the rules for telling a poet a save failed, in one place. menu.test.ts drives them through Save.
const failure = (over: Partial<Parameters<typeof failed>[0]> = {}) =>
  failed({
    filename: '/x/zq.midst',
    byPoet: false,
    firstSave: false,
    nothingUnsaved: false,
    ...over,
  });

beforeEach(() => startAgain());

describe('saveFailurePolicy', () => {
  it('the editor’s own saves tell once per file while it keeps failing', () => {
    expect(failure()).toBe(true);
    expect(failure()).toBe(false);
    expect(failure({ filename: '/x/xv.midst' })).toBe(true);
    expect(failure()).toBe(true);
  });

  it('a save the poet chooses always tells, and even when nothing was unsaved', () => {
    expect(failure({ byPoet: true })).toBe(true);
    expect(failure({ byPoet: true })).toBe(true);
    expect(failure({ byPoet: true, nothingUnsaved: true })).toBe(true);
  });

  it('the editor’s own saves say nothing, and show nothing, when nothing was unsaved', () => {
    expect(failure({ nothingUnsaved: true })).toBe(false);
    expect(showsNotSaved()).toBe(false);
  });

  it('shows the poem not saved after a failure with something unsaved, until it starts again', () => {
    expect(showsNotSaved()).toBe(false);
    failure();
    expect(showsNotSaved()).toBe(true);
    startAgain();
    expect(showsNotSaved()).toBe(false);
    expect(failure()).toBe(true);
  });
});
