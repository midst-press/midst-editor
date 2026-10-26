import {
  compareStrings,
  reconstructHTML,
} from '@midst-press/midst-format/history';
import {
  changesMade,
  emptyFirstFrame,
  startsEmpty,
} from '../shared/firstFrame';

// GitHub #29: a new poem's Timeline begins at an empty page.
describe('the empty first frame', () => {
  const first = compareStrings('', '<p>zq</p>', 3);

  it('is an empty page, and the next frame is the first text', () => {
    const history = [emptyFirstFrame(), first];
    expect(reconstructHTML('', history, 0)).toBe('');
    expect(reconstructHTML('', history, 1)).toBe('<p>zq</p>');
  });

  it('is timed when it is made', () => {
    const t = new Date('2026-10-26T05:00:00Z');
    expect(emptyFirstFrame(t).t).toEqual(t);
  });

  it('is recognised only at the start, and only when it adds nothing', () => {
    expect(startsEmpty([])).toBe(false);
    expect(startsEmpty([emptyFirstFrame()])).toBe(true);
    expect(startsEmpty([emptyFirstFrame(), first])).toBe(true);
    expect(startsEmpty([first])).toBe(false);
    expect(startsEmpty([first, emptyFirstFrame()])).toBe(false);
  });

  it('is not counted as a change the poet made', () => {
    expect(changesMade([])).toBe(0);
    expect(changesMade([emptyFirstFrame()])).toBe(0);
    expect(changesMade([emptyFirstFrame(), first])).toBe(1);
    // A poem made before the empty frame counts every change, as it did.
    expect(changesMade([first])).toBe(1);
  });
});
