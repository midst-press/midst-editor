/** @jest-environment node */
import {
  RestoreError,
  restoreFrame,
  wouldChange,
} from '../renderer/tracking/restore';
import {
  ChangeObj,
  compareStrings,
  reconstruct,
} from '../renderer/tracking/utils';

// Synthetic strings only: invented words, never a poem.

// A ProseMirror cursor position, as the editor would pass it; its value is not derived from the change.
const POS = 7;

const T = new Date('2020-11-20T20:43:29.127Z');

/** Builds a history the way the editor records it: successive texts through compareStrings. */
const buildHistory = (texts: string[]): ChangeObj[] =>
  texts.map((s, i) =>
    compareStrings(i === 0 ? '' : texts[i - 1], s, 0, new Date(T.getTime() + i))
  );

const H6_TEXTS = [
  '<p>z</p>',
  '<p>zq</p>',
  '<p>xzq</p>',
  '<p>xz\tq</p><p>qv</p>',
  '<p>x</p><p>qv</p>',
  '<p>x</p><p>qv 🙂 é</p>',
];

const last = (h: ChangeObj[]) => h.length - 1;
const NO_HISTORY = 'there is no history to restore from';
const NOT_IN_HISTORY = 'the frame to restore is not in the history';

describe('restore', () => {
  let h6: ChangeObj[];
  beforeEach(() => {
    h6 = buildHistory(H6_TEXTS);
  });

  it('fixture H6 replays to its own texts', () => {
    H6_TEXTS.forEach((text, k) => {
      expect(reconstruct('', h6, k)).toBe(text);
    });
  });

  describe('partitions and boundaries', () => {
    it('RS-EP-1 empty history throws RestoreError', () => {
      expect(() => restoreFrame([], 0, POS)).toThrow(RestoreError);
      expect(() => restoreFrame([], 0, POS)).toThrow(NO_HISTORY);
      expect(() => wouldChange([], 0)).toThrow(RestoreError);
      expect(() => wouldChange([], 0)).toThrow(NO_HISTORY);
    });

    it.each([[null], [undefined], [{}]])(
      'RS-EP-2 history %p (not an array) throws RestoreError',
      (bad) => {
        const h = bad as unknown as ChangeObj[];
        expect(() => restoreFrame(h, 0, POS)).toThrow(RestoreError);
        expect(() => restoreFrame(h, 0, POS)).toThrow(NO_HISTORY);
        expect(() => wouldChange(h, 0)).toThrow(RestoreError);
        expect(() => wouldChange(h, 0)).toThrow(NO_HISTORY);
      }
    );

    it.each([[-1], [6], [7]])(
      'RS-BVA-1 index %p is outside the history',
      (index) => {
        expect(() => restoreFrame(h6, index, POS)).toThrow(RestoreError);
        expect(() => restoreFrame(h6, index, POS)).toThrow(NOT_IN_HISTORY);
        expect(() => wouldChange(h6, index)).toThrow(RestoreError);
        expect(() => wouldChange(h6, index)).toThrow(NOT_IN_HISTORY);
      }
    );

    it.each([[1.5], [NaN], [Infinity], ['2']])(
      'RS-BVA-2 index %p is not an integer',
      (index) => {
        const i = index as unknown as number;
        expect(() => restoreFrame(h6, i, POS)).toThrow(RestoreError);
        expect(() => restoreFrame(h6, i, POS)).toThrow(NOT_IN_HISTORY);
        expect(() => wouldChange(h6, i)).toThrow(RestoreError);
        expect(() => wouldChange(h6, i)).toThrow(NOT_IN_HISTORY);
      }
    );

    it('RS-BVA-3 index 0 and index length-1 are accepted', () => {
      expect(() => restoreFrame(h6, 0, POS)).not.toThrow();
      expect(() => restoreFrame(h6, last(h6), POS)).not.toThrow();
      expect(() => wouldChange(h6, 0)).not.toThrow();
      expect(() => wouldChange(h6, last(h6))).not.toThrow();
    });

    it('RS-EP-3 single-frame history restores to a length-2 history of the same text', () => {
      const h = buildHistory(['<p>zq</p>']);
      const result = restoreFrame(h, 0, POS);
      expect(result).toHaveLength(2);
      expect(reconstruct('', result, last(result))).toBe('<p>zq</p>');
    });
  });

  describe('content', () => {
    it.each([0, 1, 2, 3, 4, 5])(
      'RS-C-1 restoring frame %i replays to that frame text',
      (k) => {
        const result = restoreFrame(h6, k, POS);
        expect(reconstruct('', result, last(result))).toBe(H6_TEXTS[k]);
      }
    );

    it('RS-C-2 restoring the last frame appends a change and leaves the text unchanged', () => {
      const result = restoreFrame(h6, 5, POS);
      expect(result).toHaveLength(h6.length + 1);
      expect(reconstruct('', result, last(result))).toBe(H6_TEXTS[5]);
    });

    it('RS-C-3 repeated restores address original frames and keep the first restore', () => {
      const first = restoreFrame(h6, 1, POS);
      const second = restoreFrame(first, 4, POS);
      expect(reconstruct('', second, last(second))).toBe(H6_TEXTS[4]);
      expect(second).toHaveLength(8);
      expect(reconstruct('', second, 6)).toBe(H6_TEXTS[1]);
    });

    it('RS-C-4 whitespace, emoji and accented letter survive exactly', () => {
      const withTab = restoreFrame(h6, 3, POS);
      const tabText = reconstruct('', withTab, last(withTab));
      expect(tabText).toBe('<p>xz\tq</p><p>qv</p>');
      expect(tabText).toContain('\t');

      const emojiText = reconstruct('', restoreFrame(h6, 5, POS), 6);
      expect(emojiText).toBe('<p>x</p><p>qv 🙂 é</p>');
      expect(emojiText).toContain('🙂');
      expect(emojiText).toContain('é');
    });
  });

  describe('non-destructive', () => {
    it('RS-ND-1 the input array is not modified', () => {
      const before = JSON.parse(JSON.stringify(h6));
      const { length } = h6;
      restoreFrame(h6, 2, POS);
      expect(JSON.parse(JSON.stringify(h6))).toEqual(before);
      expect(h6).toHaveLength(length);
    });

    it('RS-ND-2 result is one longer and shares earlier change objects', () => {
      const result = restoreFrame(h6, 2, POS);
      expect(result).toHaveLength(h6.length + 1);
      h6.forEach((c, i) => {
        expect(result[i]).toBe(c);
      });
    });

    it('RS-ND-3 every earlier frame still replays to its original text', () => {
      const result = restoreFrame(h6, 2, POS);
      H6_TEXTS.forEach((text, k) => {
        expect(reconstruct('', result, k)).toBe(text);
      });
    });
  });

  describe('the appended change', () => {
    it('RS-AC-1 carries the supplied date', () => {
      const when = new Date('2021-01-02T03:04:05.006Z');
      const result = restoreFrame(h6, 1, POS, when);
      expect(result[last(result)].t).toEqual(when);
    });

    it('RS-AC-1 defaults to a date within the run window', () => {
      const lo = Date.now();
      const result = restoreFrame(h6, 1, POS);
      const hi = Date.now();
      const { t } = result[last(result)];
      expect(t).toBeInstanceOf(Date);
      expect(t.getTime()).toBeGreaterThanOrEqual(lo);
      expect(t.getTime()).toBeLessThanOrEqual(hi);
    });

    // pos is the editor's ProseMirror cursor position, given by the caller as for every edit; an offset
    // into the HTML (front + inserted.length) would mean something else in the saved file.
    it.each([0, 1, 2, 3, 4, 5])(
      'RS-AC-2 pos is exactly the position the caller passed (frame %i)',
      (k) => {
        expect(restoreFrame(h6, k, POS)[h6.length].pos).toBe(POS);
        expect(restoreFrame(h6, k, 0)[h6.length].pos).toBe(0);
      }
    );
  });

  // The appended change is the minimal one, as an ordinary edit's is: front, end and inserted say where the
  // text changed. A change rebuilt from an empty base would replay to the same text but record the whole
  // poem as replaced. (Review of #143.)
  it.each([0, 1, 2, 3, 4])(
    'RS-AC-3 the appended change is compareStrings(current, chosen) in front, end and inserted (frame %i)',
    (k) => {
      const result = restoreFrame(h6, k, POS);
      const expected = compareStrings(
        reconstruct('', h6, h6.length - 1),
        reconstruct('', h6, k),
        0,
        T
      );
      const { front, end, inserted } = result[last(result)];
      expect({ front, end, inserted }).toEqual({
        front: expected.front,
        end: expected.end,
        inserted: expected.inserted,
      });
    }
  );

  it('RS-AC-4 a restore that changes only the start of a long text records a change at the start', () => {
    const tail = '<p>qv</p>'.repeat(50);
    const history = buildHistory([`<p>zq</p>${tail}`, `<p>xv</p>${tail}`]);
    const restored = restoreFrame(history, 0, POS, T)[2];
    expect(restored.front).toBe(3);
    expect(restored.end).toBe(4 + tail.length);
    expect(restored.inserted).toBe('zq');
  });

  it.each([[-1], [1.5], [NaN], [Infinity], ['3'], [undefined]])(
    'RS-POS-1 a cursor position %p that is not a document position is refused, and nothing changes',
    (pos) => {
      const before = JSON.stringify(h6);
      expect(() => restoreFrame(h6, 0, pos as unknown as number)).toThrow(
        new RestoreError('the cursor position is not a document position')
      );
      expect(JSON.stringify(h6)).toBe(before);
    }
  );

  describe('wouldChange', () => {
    it('RS-WC-1 false for the last frame, true for each earlier differing frame', () => {
      expect(wouldChange(h6, 5)).toBe(false);
      [0, 1, 2, 3, 4].forEach((k) => {
        expect(H6_TEXTS[k]).not.toBe(H6_TEXTS[5]);
        expect(wouldChange(h6, k)).toBe(true);
      });
    });

    it('RS-WC-2 false for an earlier frame equal to the current text', () => {
      const h = buildHistory(['a', 'ab', 'a']);
      expect(wouldChange(h, 0)).toBe(false);
      expect(wouldChange(h, 1)).toBe(true);
      expect(wouldChange(h, 2)).toBe(false);
    });

    it('RS-WC-3 does not modify the history', () => {
      const before = JSON.parse(JSON.stringify(h6));
      h6.forEach((_, k) => wouldChange(h6, k));
      expect(JSON.parse(JSON.stringify(h6))).toEqual(before);
    });
  });

  describe('errors', () => {
    it('RS-ERR-1 errors are RestoreError, named, and never quote the history', () => {
      const h = buildHistory(['<p>zq</p>', '<p>zq qv</p>']);
      const calls: Array<() => unknown> = [
        () => restoreFrame([], 0, POS),
        () => wouldChange([], 0),
        () => restoreFrame(null as unknown as ChangeObj[], 0, POS),
        () => restoreFrame(h, -1, POS),
        () => restoreFrame(h, 2, POS),
        () => restoreFrame(h, 0.5, POS),
        () => wouldChange(h, 99),
        () => wouldChange(h, '1' as unknown as number),
      ];
      calls.forEach((call) => {
        let caught: unknown;
        try {
          call();
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(RestoreError);
        const err = caught as RestoreError;
        expect(err.name).toBe('RestoreError');
        expect(err.message).not.toContain('zq');
        expect(err.message).not.toContain('qv');
      });
    });
  });
});
