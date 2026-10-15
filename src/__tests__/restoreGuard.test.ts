/** @jest-environment node */
import { ChangeObj } from '../renderer/tracking/utils';
import { restoreFrame, RestoreError } from '../renderer/tracking/restore';

// The restore checks its own result before returning it. With a correct compareStrings that check cannot
// fail, so it is tested here against a compareStrings that returns a change which does NOT produce the
// chosen frame's text: the restore must refuse rather than hand back a history that replays wrongly.
jest.mock('../renderer/tracking/utils', () => {
  const actual = jest.requireActual('../renderer/tracking/utils');
  return {
    ...actual,
    compareStrings: (str: string, _next: string, pos: number, t: Date) => ({
      inserted: 'qv',
      front: str.length,
      end: 0,
      t,
      pos,
    }),
  };
});

const POS = 7;
const t = new Date('2020-01-01T00:00:00.000Z');
const history: ChangeObj[] = [
  { inserted: '<p>zq</p>', front: 0, end: 0, t, pos: 0 },
  { inserted: 'x', front: 4, end: 5, t, pos: 5 },
];

describe('restoreFrame integrity check', () => {
  it('refuses, naming no poem text, when the restored history would not replay to the chosen frame', () => {
    const before = JSON.stringify(history);
    let thrown: unknown;
    try {
      restoreFrame(history, 0, POS, t);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RestoreError);
    expect((thrown as Error).message).toBe(
      'the restored history does not replay to the chosen frame'
    );
    expect((thrown as Error).message).not.toMatch(/zq|qv/);
    expect(JSON.stringify(history)).toBe(before);
  });
});
