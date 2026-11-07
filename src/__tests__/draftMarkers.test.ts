/** @jest-environment node */
import {
  createMarker,
  deleteMarker,
  markerAt,
  MarkerResult,
  Meta,
  renameMarker,
  restoreMarker,
  shownMarkers,
} from '../renderer/tracking/draftMarkers';

// Synthetic names only: invented words, never a poem's.

const metaOf = (result: MarkerResult): Meta => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.meta;
};
const refusal = (result: MarkerResult) =>
  result.ok ? 'accepted' : result.reason;
const frozen = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
};

describe('createMarker', () => {
  it('adds the first marker as Draft 1 and starts the counter', () => {
    expect(metaOf(createMarker({}, 4, 10))).toEqual({
      draftMarkers: [{ index: 4, defaultName: 'Draft 1' }],
      highestDraftNumber: 1,
    });
  });

  it('gives a new marker no name of its own', () => {
    const [marker] = metaOf(createMarker({}, 0, 1)).draftMarkers as object[];
    expect('name' in marker).toBe(false);
  });

  // GitHub #117, option a: the numbers follow the Timeline, not the order the drafts were made in.
  it('appends in the order made, and numbers in Timeline order', () => {
    const one = metaOf(createMarker({}, 7, 10));
    const two = metaOf(createMarker(one, 2, 10));
    expect(two.draftMarkers).toEqual([
      { index: 7, defaultName: 'Draft 2' },
      { index: 2, defaultName: 'Draft 1' },
    ]);
    expect(two.highestDraftNumber).toBe(2);
  });

  it('accepts the first and the last history position', () => {
    expect(refusal(createMarker({}, 0, 3))).toBe('accepted');
    expect(refusal(createMarker({}, 2, 3))).toBe('accepted');
  });

  it.each([
    ['one past the end', 3, 3],
    ['before the start', -1, 3],
    ['a fraction', 1.5, 3],
    ['not a number', NaN, 3],
    ['anything, in an empty history', 0, 0],
  ])('refuses a position that is %s', (_what, index, length) => {
    expect(refusal(createMarker({}, index, length))).toBe(
      'not-a-history-position'
    );
  });

  it.each([
    ['not a number', NaN],
    ['missing', undefined as unknown as number],
    ['a fraction', 2.5],
    ['infinite', Infinity],
    ['negative', -1],
  ])(
    'refuses every position when the history length is %s',
    (_what, length) => {
      expect(refusal(createMarker({}, 0, length))).toBe(
        'not-a-history-position'
      );
      expect(refusal(createMarker({}, 2, length))).toBe(
        'not-a-history-position'
      );
      expect(refusal(createMarker({}, 5, length))).toBe(
        'not-a-history-position'
      );
    }
  );

  it('refuses a second marker at a position that has one', () => {
    const one = metaOf(createMarker({}, 4, 10));
    expect(refusal(createMarker(one, 4, 10))).toBe('position-has-a-marker');
  });

  it('keeps unknown meta keys, extra marker keys, out-of-range markers and entries that are not markers', () => {
    const before = frozen({
      fontSize: 12,
      laterField: { zq: [1, 2] },
      highestDraftNumber: 3,
      draftMarkers: [
        {
          index: 1,
          name: 'zq',
          defaultName: 'Draft 1',
          description: 'xv',
          timestamp: 5,
        },
        { index: 99, defaultName: 'Draft 3' },
        'qz',
        null,
        { name: 'no index' },
      ],
    });
    const after = metaOf(createMarker(before, 2, 10));
    // The marker outside the history keeps its place and its extra keys; it is numbered after those on the
    // Timeline. The named one takes no number.
    expect(after).toEqual({
      ...before,
      highestDraftNumber: 2,
      draftMarkers: [
        before.draftMarkers[0],
        { index: 99, defaultName: 'Draft 2' },
        'qz',
        null,
        { name: 'no index' },
        { index: 2, defaultName: 'Draft 1' },
      ],
    });
    expect((after.draftMarkers as unknown[])[0]).toBe(before.draftMarkers[0]);
  });

  it('does not change the meta it is given', () => {
    const before = frozen({
      draftMarkers: [{ index: 1, defaultName: 'Draft 1' }],
      highestDraftNumber: 1,
    });
    expect(() => createMarker(before, 2, 10)).not.toThrow();
    expect(before.draftMarkers).toHaveLength(1);
  });

  describe('numbers the default names in Timeline order (GitHub #117, option a)', () => {
    const names = (meta: Meta) =>
      (meta.draftMarkers as { index: number; defaultName?: string }[]).map(
        (m) => [m.index, m.defaultName]
      );

    it('moves the later drafts up one when a draft is made before them', () => {
      let meta = metaOf(createMarker({}, 2, 10));
      meta = metaOf(createMarker(meta, 8, 10));
      meta = metaOf(createMarker(meta, 5, 10));
      expect(names(meta)).toEqual([
        [2, 'Draft 1'],
        [8, 'Draft 3'],
        [5, 'Draft 2'],
      ]);
      expect(meta.highestDraftNumber).toBe(3);
    });

    it("gives a deleted draft's number to the next one along, so there is no gap", () => {
      let meta = metaOf(createMarker({}, 1, 10));
      meta = metaOf(createMarker(meta, 2, 10));
      meta = metaOf(createMarker(meta, 3, 10));
      meta = metaOf(deleteMarker(meta, 2));
      expect(names(meta)).toEqual([
        [1, 'Draft 1'],
        [3, 'Draft 2'],
      ]);
      expect(meta.highestDraftNumber).toBe(2);
    });

    it('numbers past a draft with a name of its own, which takes no number', () => {
      const meta = metaOf(
        createMarker(
          { draftMarkers: [{ index: 2, name: 'zq', defaultName: 'Draft 1' }] },
          5,
          10
        )
      );
      const withFirst = metaOf(createMarker(meta, 1, 10));
      expect(shownMarkers(withFirst, 10)).toEqual([
        { index: 2, label: 'zq' },
        { index: 5, label: 'Draft 2' },
        { index: 1, label: 'Draft 1' },
      ]);
      expect(withFirst.highestDraftNumber).toBe(2);
    });

    it('renumbers what an older file has, on its first change: stale names, a stale counter, names not in the form', () => {
      const meta = {
        highestDraftNumber: 2,
        draftMarkers: [
          { index: 6, defaultName: 'Draft 9' },
          { index: 4, defaultName: 'Draft 12b' },
          { index: 3, defaultName: 40 },
          { index: 1 },
        ],
      };
      expect(names(metaOf(createMarker(meta, 8, 10)))).toEqual([
        [6, 'Draft 4'],
        [4, 'Draft 3'],
        [3, 'Draft 2'],
        [1, 'Draft 1'],
        [8, 'Draft 5'],
      ]);
    });

    it('numbers two markers at one position in the order of the list', () => {
      const twins = {
        draftMarkers: [
          { index: 4, defaultName: 'Draft 7' },
          { index: 4, defaultName: 'Draft 1' },
        ],
      };
      expect(names(metaOf(createMarker(twins, 9, 10)))).toEqual([
        [4, 'Draft 1'],
        [4, 'Draft 2'],
        [9, 'Draft 3'],
      ]);
    });

    it('carries a name that was its default name along with the new number', () => {
      const meta = {
        draftMarkers: [{ index: 5, name: 'Draft 1', defaultName: 'Draft 1' }],
      };
      expect(metaOf(createMarker(meta, 2, 10)).draftMarkers).toEqual([
        { index: 5, name: 'Draft 2', defaultName: 'Draft 2' },
        { index: 2, defaultName: 'Draft 1' },
      ]);
    });

    // clement-7074f29f, review of #467: neither comes from this app's renames, only from converted or edited files.
    it('numbers a marker at a negative position after every one on the Timeline', () => {
      const meta = metaOf(
        createMarker(
          {
            draftMarkers: [
              { index: -1, defaultName: 'Draft 1' },
              { index: 5, defaultName: 'Draft 2' },
            ],
          },
          8,
          10
        )
      );
      expect(shownMarkers(meta, 10).map((m) => m.label)).toEqual([
        'Draft 1',
        'Draft 2',
      ]);
      expect(names(meta)).toEqual([
        [-1, 'Draft 3'],
        [5, 'Draft 1'],
        [8, 'Draft 2'],
      ]);
    });

    it('numbers a name of only spaces, and shows its number, not the spaces', () => {
      const meta = metaOf(
        createMarker(
          {
            draftMarkers: [
              { index: 2, defaultName: 'Draft 1' },
              { index: 4, name: '  ', defaultName: 'Draft 2' },
            ],
          },
          8,
          10
        )
      );
      expect(shownMarkers(meta, 10).map((m) => m.label)).toEqual([
        'Draft 1',
        'Draft 2',
        'Draft 3',
      ]);
    });

    it('leaves a marker whose number does not change as the same object', () => {
      const first = { index: 1, defaultName: 'Draft 1', timestamp: 3 };
      const after = metaOf(createMarker({ draftMarkers: [first] }, 4, 10));
      expect((after.draftMarkers as unknown[])[0]).toBe(first);
    });
  });

  it('refuses, and leaves the file alone, when draftMarkers is not a list', () => {
    expect(refusal(createMarker({ draftMarkers: { index: 1 } }, 2, 10))).toBe(
      'markers-unreadable'
    );
    expect(refusal(createMarker({ draftMarkers: null }, 2, 10))).toBe(
      'markers-unreadable'
    );
  });
});

describe('renameMarker', () => {
  const meta = frozen({
    laterField: true,
    highestDraftNumber: 2,
    draftMarkers: [
      { index: 5, defaultName: 'Draft 1', description: 'xv' },
      { index: 3, name: 'zq', defaultName: 'Draft 2' },
    ],
  });

  it('names the marker at that position and changes nothing else of it', () => {
    expect(metaOf(renameMarker(meta, 5, 'qz vx'))).toEqual({
      ...meta,
      highestDraftNumber: 0,
      draftMarkers: [
        { index: 5, name: 'qz vx', defaultName: 'Draft 1', description: 'xv' },
        meta.draftMarkers[1],
      ],
    });
  });

  // GitHub #117: a name of its own takes the draft out of the numbering, and the numbers run on without it.
  it('renumbers the default names after a draft is given a name of its own, and when it loses it', () => {
    const three = {
      draftMarkers: [
        { index: 1, defaultName: 'Draft 1' },
        { index: 4, defaultName: 'Draft 2' },
        { index: 7, defaultName: 'Draft 3' },
      ],
    };
    const named = metaOf(renameMarker(three, 4, 'zq'));
    expect(shownMarkers(named, 10).map((m) => m.label)).toEqual([
      'Draft 1',
      'zq',
      'Draft 2',
    ]);
    expect(named.highestDraftNumber).toBe(2);
    const unnamed = metaOf(renameMarker(named, 4, ''));
    expect(shownMarkers(unnamed, 10).map((m) => m.label)).toEqual([
      'Draft 1',
      'Draft 2',
      'Draft 3',
    ]);
  });

  it('replaces an earlier name', () => {
    const [, second] = metaOf(renameMarker(meta, 3, 'vx'))
      .draftMarkers as object[];
    expect(second).toEqual({ index: 3, name: 'vx', defaultName: 'Draft 2' });
  });

  it('keeps a name exactly as typed, spaces included', () => {
    const [first] = metaOf(renameMarker(meta, 5, '  zq  ')).draftMarkers as {
      name: string;
    }[];
    expect(first.name).toBe('  zq  ');
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['only a tab and a newline', '\t\n'],
  ])(
    'puts the default name back when the new name is %s, numbered for its place',
    (_what, name) => {
      // At position 3 it comes before the draft at 5, so it is Draft 1 now, and that one is Draft 2.
      expect(metaOf(renameMarker(meta, 3, name)).draftMarkers).toEqual([
        { index: 5, defaultName: 'Draft 2', description: 'xv' },
        { index: 3, name: 'Draft 1', defaultName: 'Draft 1' },
      ]);
    }
  );

  it('gives a marker that had no default name one when its name is emptied', () => {
    const bare = { draftMarkers: [{ index: 1, name: 'zq' }] };
    expect(metaOf(renameMarker(bare, 1, '')).draftMarkers).toEqual([
      { index: 1, defaultName: 'Draft 1' },
    ]);
  });

  it('writes the counter as the number of default names', () => {
    expect(metaOf(renameMarker(meta, 5, 'zq')).highestDraftNumber).toBe(0);
    expect(
      metaOf(
        renameMarker(
          { draftMarkers: [{ index: 1 }, { index: 2, name: 'xv' }] },
          2,
          'zq'
        )
      ).highestDraftNumber
    ).toBe(1);
  });

  it('can name a marker that points outside the history', () => {
    const outside = { draftMarkers: [{ index: 99, defaultName: 'Draft 1' }] };
    expect(metaOf(renameMarker(outside, 99, 'zq')).draftMarkers).toEqual([
      { index: 99, name: 'zq', defaultName: 'Draft 1' },
    ]);
  });

  it('renames only the first of two markers that share a position, and the other is Draft 1 now', () => {
    const twins = {
      draftMarkers: [
        { index: 1, defaultName: 'Draft 1' },
        { index: 1, defaultName: 'Draft 2' },
      ],
    };
    expect(metaOf(renameMarker(twins, 1, 'zq')).draftMarkers).toEqual([
      { index: 1, name: 'zq', defaultName: 'Draft 1' },
      { index: 1, defaultName: 'Draft 1' },
    ]);
  });

  it('refuses when no marker is at that position, or there are no markers', () => {
    expect(refusal(renameMarker(meta, 4, 'zq'))).toBe('no-marker-there');
    expect(refusal(renameMarker({}, 4, 'zq'))).toBe('no-marker-there');
  });

  it('refuses when draftMarkers is not a list', () => {
    expect(refusal(renameMarker({ draftMarkers: 'zq' }, 1, 'xv'))).toBe(
      'markers-unreadable'
    );
  });
});

describe('deleteMarker', () => {
  it('removes the marker at that position, keeps the others in order, and numbers on without it', () => {
    const meta = frozen({
      laterField: 'zq',
      highestDraftNumber: 3,
      draftMarkers: [
        { index: 5, defaultName: 'Draft 1' },
        { index: 3, name: 'zq', defaultName: 'Draft 2' },
        'qz',
        { index: 8, defaultName: 'Draft 3' },
      ],
    });
    // The named draft goes, so Draft 1 at 5 and Draft 3 at 8 become Draft 1 and Draft 2 in Timeline order.
    expect(metaOf(deleteMarker(meta, 3))).toEqual({
      laterField: 'zq',
      highestDraftNumber: 2,
      draftMarkers: [
        meta.draftMarkers[0],
        'qz',
        { index: 8, defaultName: 'Draft 2' },
      ],
    });
  });

  it('writes the counter as the number of default names left, so a file with none says 0', () => {
    const meta = {
      highestDraftNumber: 9,
      draftMarkers: [{ index: 1, defaultName: 'Draft 4' }],
    };
    expect(metaOf(deleteMarker(meta, 1))).toEqual({
      draftMarkers: [],
      highestDraftNumber: 0,
    });
  });

  it('removes only the first of two markers that share a position', () => {
    const twins = {
      draftMarkers: [
        { index: 1, defaultName: 'Draft 1' },
        { index: 1, defaultName: 'Draft 2' },
      ],
    };
    expect(metaOf(deleteMarker(twins, 1)).draftMarkers).toEqual([
      { index: 1, defaultName: 'Draft 1' },
    ]);
  });

  it('can remove a marker that points outside the history', () => {
    const outside = { draftMarkers: [{ index: 99, defaultName: 'Draft 1' }] };
    expect(metaOf(deleteMarker(outside, 99)).draftMarkers).toEqual([]);
  });

  it('refuses when no marker is at that position, or draftMarkers is not a list', () => {
    expect(refusal(deleteMarker({ draftMarkers: [{ index: 1 }] }, 2))).toBe(
      'no-marker-there'
    );
    expect(refusal(deleteMarker({}, 2))).toBe('no-marker-there');
    expect(refusal(deleteMarker({ draftMarkers: 7 }, 2))).toBe(
      'markers-unreadable'
    );
  });
});

describe('shownMarkers', () => {
  it('lists the markers inside the history, in the file order, with the name the poet gave', () => {
    const meta = {
      draftMarkers: [
        { index: 5, name: 'zq', defaultName: 'Draft 1' },
        { index: 0, defaultName: 'Draft 2' },
        { index: 9, name: '', defaultName: 'Draft 3' },
        { index: 2 },
      ],
    };
    expect(shownMarkers(meta, 10)).toEqual([
      { index: 5, label: 'zq' },
      { index: 0, label: 'Draft 2' },
      { index: 9, label: 'Draft 3' },
      { index: 2, label: 'Draft' },
    ]);
  });

  it('leaves out markers outside the history and entries that are not markers', () => {
    const meta = {
      draftMarkers: [
        { index: 10, defaultName: 'Draft 1' },
        { index: -1, defaultName: 'Draft 2' },
        { index: 1.5, defaultName: 'Draft 3' },
        { index: '3', defaultName: 'Draft 4' },
        'qz',
        null,
        { index: 9, name: 7, defaultName: 8 },
      ],
    };
    expect(shownMarkers(meta, 10)).toEqual([{ index: 9, label: 'Draft' }]);
  });

  it('shows nothing for a document without markers, an empty history, or an unreadable list', () => {
    expect(shownMarkers({}, 10)).toEqual([]);
    expect(shownMarkers({ draftMarkers: [{ index: 0 }] }, 0)).toEqual([]);
    expect(shownMarkers({ draftMarkers: { index: 0 } }, 10)).toEqual([]);
  });

  it('shows a marker made by createMarker and renamed by renameMarker', () => {
    let meta = metaOf(createMarker({}, 3, 5));
    expect(shownMarkers(meta, 5)).toEqual([{ index: 3, label: 'Draft 1' }]);
    meta = metaOf(renameMarker(meta, 3, 'zq'));
    expect(shownMarkers(meta, 5)).toEqual([{ index: 3, label: 'zq' }]);
  });
});

describe('restoreMarker: undoing a delete (#277)', () => {
  const kept = { index: 5, name: 'zq', defaultName: 'Draft 2', timestamp: 7 };
  const before: Meta = {
    other: 'xv',
    highestDraftNumber: 3,
    draftMarkers: [
      { index: 1, defaultName: 'Draft 1' },
      kept,
      { index: 9, defaultName: 'Draft 3' },
    ],
  };

  it('puts the marker back exactly as it was, at its place in the list', () => {
    const found = markerAt(before, 5);
    expect(found).toEqual({ marker: kept, position: 1 });
    const after = metaOf(deleteMarker(before, 5));
    const restored = metaOf(restoreMarker(after, kept, 1));
    // Its own name, stale default name and extra keys come back as they were. It has a name of its own, so the
    // default names around it are Draft 1 and Draft 2.
    expect((restored.draftMarkers as unknown[])[1]).toBe(kept);
    expect(restored).toEqual({
      ...before,
      highestDraftNumber: 2,
      draftMarkers: [
        { index: 1, defaultName: 'Draft 1' },
        kept,
        { index: 9, defaultName: 'Draft 2' },
      ],
    });
  });

  it('numbers a default-named draft that is put back for its place, and the ones after it again', () => {
    const plain = { index: 5, defaultName: 'Draft 2' };
    const three: Meta = {
      draftMarkers: [
        { index: 1, defaultName: 'Draft 1' },
        plain,
        { index: 9, defaultName: 'Draft 3' },
      ],
    };
    const deleted = metaOf(deleteMarker(three, 5));
    expect(shownMarkers(deleted, 10).map((m) => m.label)).toEqual([
      'Draft 1',
      'Draft 2',
    ]);
    expect(metaOf(restoreMarker(deleted, plain, 1))).toEqual({
      ...three,
      highestDraftNumber: 3,
    });
  });

  it('refuses when another marker now holds the position', () => {
    const after = metaOf(createMarker(metaOf(deleteMarker(before, 5)), 5, 30));
    expect(refusal(restoreMarker(after, kept, 1))).toBe(
      'position-has-a-marker'
    );
  });

  it('puts it at the end when the list is now shorter than its old place', () => {
    const restored = metaOf(restoreMarker({ draftMarkers: [] }, kept, 4));
    expect(restored.draftMarkers).toEqual([kept]);
  });

  it('refuses a list it cannot read, and changes nothing', () => {
    const unreadable = frozen({ draftMarkers: 'zq' });
    expect(refusal(restoreMarker(unreadable, kept, 0))).toBe(
      'markers-unreadable'
    );
    expect(markerAt(unreadable, 5)).toBeNull();
  });

  it('finds no marker where there is none', () => {
    expect(markerAt(before, 6)).toBeNull();
  });
});
