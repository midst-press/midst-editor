/** @jest-environment node */
import {
  createMarker,
  deleteMarker,
  MarkerResult,
  Meta,
  renameMarker,
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

  it('appends in the order made, not in history order, and counts on', () => {
    const one = metaOf(createMarker({}, 7, 10));
    const two = metaOf(createMarker(one, 2, 10));
    expect(two.draftMarkers).toEqual([
      { index: 7, defaultName: 'Draft 1' },
      { index: 2, defaultName: 'Draft 2' },
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
    expect(after).toEqual({
      ...before,
      highestDraftNumber: 4,
      draftMarkers: [
        ...before.draftMarkers,
        { index: 2, defaultName: 'Draft 4' },
      ],
    });
  });

  it('does not change the meta it is given', () => {
    const before = frozen({
      draftMarkers: [{ index: 1, defaultName: 'Draft 1' }],
      highestDraftNumber: 1,
    });
    expect(() => createMarker(before, 2, 10)).not.toThrow();
    expect(before.draftMarkers).toHaveLength(1);
  });

  describe('never repeats a draft number', () => {
    it('after the newest marker was deleted', () => {
      let meta = metaOf(createMarker({}, 1, 10));
      meta = metaOf(createMarker(meta, 2, 10));
      meta = metaOf(deleteMarker(meta, 2));
      meta = metaOf(createMarker(meta, 3, 10));
      expect(meta.draftMarkers).toEqual([
        { index: 1, defaultName: 'Draft 1' },
        { index: 3, defaultName: 'Draft 3' },
      ]);
    });

    it('when only the counter remembers the drafts, every marker having been deleted', () => {
      expect(metaOf(createMarker({ highestDraftNumber: 1 }, 2, 10))).toEqual({
        highestDraftNumber: 2,
        draftMarkers: [{ index: 2, defaultName: 'Draft 2' }],
      });
      expect(
        metaOf(createMarker({ highestDraftNumber: 7, draftMarkers: [] }, 2, 10))
          .highestDraftNumber
      ).toBe(8);
    });

    it('when the file has markers and no counter', () => {
      const meta = { draftMarkers: [{ index: 1, defaultName: 'Draft 6' }] };
      expect(metaOf(createMarker(meta, 2, 10)).highestDraftNumber).toBe(7);
    });

    it('when the counter is behind the default names in the file', () => {
      const meta = {
        highestDraftNumber: 2,
        draftMarkers: [{ index: 1, defaultName: 'Draft 9' }],
      };
      expect(metaOf(createMarker(meta, 2, 10)).highestDraftNumber).toBe(10);
    });

    it('when the counter is ahead of every default name', () => {
      const meta = {
        highestDraftNumber: 20,
        draftMarkers: [{ index: 1, defaultName: 'Draft 9' }],
      };
      expect(metaOf(createMarker(meta, 2, 10)).highestDraftNumber).toBe(21);
    });

    it.each([
      ['a string', '4'],
      ['negative', -3],
      ['a fraction', 2.5],
      ['null', null],
    ])(
      'when the stored counter is %s, by counting from the default names',
      (_what, stored) => {
        const meta = {
          highestDraftNumber: stored,
          draftMarkers: [{ index: 1, defaultName: 'Draft 2' }],
        };
        expect(metaOf(createMarker(meta, 2, 10)).highestDraftNumber).toBe(3);
      }
    );

    it('when a default name holds a number too large to count exactly', () => {
      let meta: Meta = {
        draftMarkers: [
          { index: 1, defaultName: 'Draft 9007199254740993' },
          { index: 2, defaultName: 'Draft 3' },
        ],
      };
      meta = metaOf(createMarker(meta, 4, 10));
      meta = metaOf(createMarker(meta, 5, 10));
      expect(
        (meta.draftMarkers as { defaultName: string }[])
          .slice(2)
          .map((m) => m.defaultName)
      ).toEqual(['Draft 4', 'Draft 5']);
      expect(meta.highestDraftNumber).toBe(5);
    });

    it('by refusing when the counter is at the largest number that can be counted exactly', () => {
      const meta = { highestDraftNumber: Number.MAX_SAFE_INTEGER };
      expect(refusal(createMarker(meta, 1, 10))).toBe('no-draft-number-left');
      expect(
        refusal(
          createMarker(
            { highestDraftNumber: Number.MAX_SAFE_INTEGER - 1 },
            1,
            10
          )
        )
      ).toBe('accepted');
    });

    it('ignoring default names that are not "Draft <number>" and ones that are not text', () => {
      const meta = {
        draftMarkers: [
          { index: 1, defaultName: 'Draft 12b' },
          { index: 2, defaultName: 'zq Draft 30' },
          { index: 3, defaultName: 40 },
          { index: 4 },
        ],
      };
      expect(metaOf(createMarker(meta, 5, 10)).highestDraftNumber).toBe(1);
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

  it('names the marker at that position and touches nothing else', () => {
    expect(metaOf(renameMarker(meta, 5, 'qz vx'))).toEqual({
      ...meta,
      draftMarkers: [
        { index: 5, name: 'qz vx', defaultName: 'Draft 1', description: 'xv' },
        meta.draftMarkers[1],
      ],
    });
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
  ])('puts the default name back when the new name is %s', (_what, name) => {
    const [, second] = metaOf(renameMarker(meta, 3, name))
      .draftMarkers as object[];
    expect(second).toEqual({
      index: 3,
      name: 'Draft 2',
      defaultName: 'Draft 2',
    });
  });

  it('leaves a marker that has no default name without a name when the new name is empty', () => {
    const bare = { draftMarkers: [{ index: 1, name: 'zq' }] };
    expect(metaOf(renameMarker(bare, 1, '')).draftMarkers).toEqual([
      { index: 1 },
    ]);
  });

  it('does not change the counter', () => {
    expect(metaOf(renameMarker(meta, 5, 'zq')).highestDraftNumber).toBe(2);
    expect(
      'highestDraftNumber' in
        metaOf(renameMarker({ draftMarkers: [{ index: 1 }] }, 1, 'zq'))
    ).toBe(false);
  });

  it('can name a marker that points outside the history', () => {
    const outside = { draftMarkers: [{ index: 99, defaultName: 'Draft 1' }] };
    expect(metaOf(renameMarker(outside, 99, 'zq')).draftMarkers).toEqual([
      { index: 99, name: 'zq', defaultName: 'Draft 1' },
    ]);
  });

  it('renames only the first of two markers that share a position', () => {
    const twins = {
      draftMarkers: [
        { index: 1, defaultName: 'Draft 1' },
        { index: 1, defaultName: 'Draft 2' },
      ],
    };
    expect(metaOf(renameMarker(twins, 1, 'zq')).draftMarkers).toEqual([
      { index: 1, name: 'zq', defaultName: 'Draft 1' },
      { index: 1, defaultName: 'Draft 2' },
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
  it('removes the marker at that position, keeps the others in order, and keeps the counter', () => {
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
    expect(metaOf(deleteMarker(meta, 3))).toEqual({
      laterField: 'zq',
      highestDraftNumber: 3,
      draftMarkers: [meta.draftMarkers[0], 'qz', meta.draftMarkers[3]],
    });
  });

  it('writes the counter when the file had none, so the number cannot come back', () => {
    const meta = { draftMarkers: [{ index: 1, defaultName: 'Draft 4' }] };
    expect(metaOf(deleteMarker(meta, 1))).toEqual({
      draftMarkers: [],
      highestDraftNumber: 4,
    });
  });

  it('raises a counter that was behind the deleted marker, and never lowers one', () => {
    const behind = {
      highestDraftNumber: 1,
      draftMarkers: [{ index: 1, defaultName: 'Draft 4' }],
    };
    expect(metaOf(deleteMarker(behind, 1)).highestDraftNumber).toBe(4);
    const ahead = {
      highestDraftNumber: 9,
      draftMarkers: [{ index: 1, defaultName: 'Draft 4' }],
    };
    expect(metaOf(deleteMarker(ahead, 1)).highestDraftNumber).toBe(9);
  });

  it('removes only the first of two markers that share a position', () => {
    const twins = {
      draftMarkers: [
        { index: 1, defaultName: 'Draft 1' },
        { index: 1, defaultName: 'Draft 2' },
      ],
    };
    expect(metaOf(deleteMarker(twins, 1)).draftMarkers).toEqual([
      { index: 1, defaultName: 'Draft 2' },
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
