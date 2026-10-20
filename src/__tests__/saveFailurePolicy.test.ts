import {
  failed,
  mayAskWhereToSave,
  showsNotSaved,
  startAgain,
} from '../main/saveFailurePolicy';

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
    expect(mayAskWhereToSave(false)).toBe(true);
  });

  it('shows the poem not saved after a failure with something unsaved, until it starts again', () => {
    expect(showsNotSaved()).toBe(false);
    failure();
    expect(showsNotSaved()).toBe(true);
    startAgain();
    expect(showsNotSaved()).toBe(false);
    expect(failure()).toBe(true);
  });

  it('after a failed first save only the poet’s own saves may open the save panel', () => {
    expect(mayAskWhereToSave(false)).toBe(true);
    failure({ filename: '/x/zq.midst', byPoet: true, firstSave: true });
    expect(mayAskWhereToSave(false)).toBe(false);
    expect(mayAskWhereToSave(true)).toBe(true);
    startAgain();
    expect(mayAskWhereToSave(false)).toBe(true);
  });

  it('a failed save of a document that has a file leaves the panel to the editor as before', () => {
    failure();
    expect(mayAskWhereToSave(false)).toBe(true);
  });
});
