import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import DraftDrawer, {
  fitsTheField,
  LEAVE_MS,
} from '../renderer/components/DraftMarkers/DraftDrawer';

// Synthetic names only.

const MARKERS = [
  { index: 7, label: 'zq' },
  { index: 2, label: 'Draft 2' },
  { index: 30, label: 'xv' },
];

interface HarnessProps {
  onJump: jest.Mock;
  onRename: jest.Mock;
  onDelete: jest.Mock;
  onShow: jest.Mock;
  startNaming: number | null;
  markers: typeof MARKERS;
  refusal: string | null;
  deletedAt: number | null;
  onUndo: jest.Mock;
  onClose: jest.Mock;
}

function Harness({
  onJump,
  onRename,
  onDelete,
  onShow,
  startNaming,
  markers,
  refusal,
  deletedAt,
  onUndo,
  onClose,
}: HarnessProps) {
  const [naming, setNaming] = useState<number | null>(startNaming);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showTimestamp, setShowTimestamp] = useState(false);
  return (
    <DraftDrawer
      open
      onClose={onClose}
      markers={markers}
      naming={naming}
      setNaming={setNaming}
      onJump={onJump}
      onRename={onRename}
      onDelete={onDelete}
      deletedAt={deletedAt}
      onUndo={onUndo}
      refusal={refusal}
      showMarkers={showMarkers}
      setShowMarkers={(shown) => {
        onShow('markers', shown);
        setShowMarkers(shown);
      }}
      showLabels={showLabels}
      setShowLabels={(shown) => {
        onShow('labels', shown);
        setShowLabels(shown);
      }}
      showTimestamp={showTimestamp}
      setShowTimestamp={(shown) => {
        onShow('timestamp', shown);
        setShowTimestamp(shown);
      }}
    />
  );
}

// Renders the drawer with every callback a mock, except those the test supplies.
const show = (given: Partial<HarnessProps> = {}) =>
  render(
    <Harness
      onJump={given.onJump ?? jest.fn()}
      onRename={given.onRename ?? jest.fn()}
      onDelete={given.onDelete ?? jest.fn()}
      onShow={given.onShow ?? jest.fn()}
      startNaming={given.startNaming ?? null}
      markers={given.markers ?? MARKERS}
      refusal={given.refusal ?? null}
      deletedAt={given.deletedAt ?? null}
      onUndo={given.onUndo ?? jest.fn()}
      onClose={given.onClose ?? jest.fn()}
    />
  );

const names = () =>
  Array.from(document.querySelectorAll('.DraftDrawer .draft-name')).map(
    (b) => b.textContent
  );

describe('DraftDrawer', () => {
  // GitHub #94: the drafts list is now the Settings panel, with Show timestamp at its bottom, off at first.
  it('is the Settings panel, with the drafts under their own heading and Show timestamp last, off', () => {
    const onShow = jest.fn();
    show({ onShow });
    expect(
      screen.getByRole('complementary', { name: 'Settings' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Settings' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Draft Markers' })
    ).toBeInTheDocument();
    const timestamp = screen.getByRole('checkbox', { name: 'Show timestamp' });
    expect(timestamp).not.toBeChecked();
    const panel = document.querySelector('.DraftDrawer')!;
    const controls = Array.from(
      panel.querySelectorAll('input, button')
    ) as Element[];
    expect(controls[controls.length - 1]).toBe(timestamp);
    fireEvent.click(timestamp);
    expect(onShow).toHaveBeenLastCalledWith('timestamp', true);
    expect(timestamp).toBeChecked();
  });

  // GitHub #117, item 2: in timeline order, the latest on top, not the order they were made (7, 2, 30 here).
  it('lists the drafts in timeline order, the latest on top', () => {
    show();
    expect(names()).toEqual(['xv', 'zq', 'Draft 2']);
  });

  // GitHub #117, item 6: one more way to close it.
  it('closes from the X at its top', () => {
    const onClose = jest.fn();
    show({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when there are no drafts', () => {
    show({ markers: [] });
    expect(screen.getByText('No Draft Markers yet.')).toBeInTheDocument();
  });

  it('goes to the moment of the draft that is chosen', () => {
    const onJump = jest.fn();
    show({ onJump });
    fireEvent.click(screen.getByText('Draft 2'));
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it('opens a name for typing with the current name in it, and saves it on Enter', () => {
    const onRename = jest.fn();
    show({ onRename });
    fireEvent.click(screen.getAllByLabelText('Rename Draft Marker')[1]);
    const field = screen.getByLabelText(
      'Draft Marker name'
    ) as HTMLInputElement;
    expect(field.value).toBe('zq');
    fireEvent.change(field, { target: { value: 'qz vx' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(7, 'qz vx');
    expect(screen.queryByLabelText('Draft Marker name')).toBeNull();
  });

  it('opening another draft for naming shows that draft’s name, not what was typed for the last', () => {
    show();
    const seen = screen
      .getAllByLabelText('Rename Draft Marker')
      .map((button) => {
        fireEvent.click(button);
        const field = screen.getByLabelText(
          'Draft Marker name'
        ) as HTMLInputElement;
        const { value } = field;
        fireEvent.change(field, { target: { value: 'typed, not saved' } });
        return value;
      });
    expect(seen.sort()).toEqual(['Draft 2', 'xv', 'zq']);
  });

  it('saves the name when the field is left', () => {
    const onRename = jest.fn();
    show({ onRename, startNaming: 2 });
    const field = screen.getByLabelText(
      'Draft Marker name'
    ) as HTMLInputElement;
    expect(field.value).toBe('Draft 2');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(onRename).toHaveBeenCalledWith(2, '');
  });

  it('leaves the name alone on Escape', () => {
    const onRename = jest.fn();
    show({ onRename, startNaming: 7 });
    const field = screen.getByLabelText('Draft Marker name');
    fireEvent.change(field, { target: { value: 'qz' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(names()).toContain('zq');
  });

  it('deletes at once, and does not rename the draft being deleted', () => {
    const onDelete = jest.fn();
    const onRename = jest.fn();
    show({ onDelete, onRename, startNaming: 30 });
    fireEvent.click(screen.getAllByLabelText('Delete Draft Marker')[0]);
    expect(onDelete).toHaveBeenCalledWith(30);
    expect(onRename).not.toHaveBeenCalled();
  });

  it('switches the timeline markers and their names on and off', () => {
    const onShow = jest.fn();
    show({ onShow });
    fireEvent.click(
      screen.getByLabelText('Show Draft Markers on the Timeline')
    );
    fireEvent.click(screen.getByLabelText('Show their names'));
    expect(onShow.mock.calls).toEqual([
      ['markers', false],
      ['labels', false],
    ]);
  });
});

describe('DraftDrawer: refusal', () => {
  it('shows why a change was refused, in an alert', () => {
    show({ refusal: 'That Draft Marker is no longer there.' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That Draft Marker is no longer there.'
    );
  });

  it('shows no alert when nothing was refused', () => {
    show();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // GitHub #117: the deleted draft's own row says so, with Undo at its end, in its place on the Timeline.
  it("puts Undo in the deleted draft's row, in its place, and Undo calls back (#277)", () => {
    const onUndo = jest.fn();
    show({ deletedAt: 5, onUndo });
    const rows = Array.from(document.querySelectorAll('.DraftDrawer li'));
    expect(rows.map((r) => r.textContent)).toEqual([
      'xv',
      'zq',
      'Draft Marker deleted.Undo',
      'Draft 2',
    ]);
    const deleted = rows[2];
    expect(deleted).toHaveClass('DraftDeleted');
    expect(deleted.querySelector('em')).toHaveTextContent(
      'Draft Marker deleted.'
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Draft Marker deleted.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  describe('when the time to put it back is up', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    // The panel with `deletedAt` and `markers`, every callback a mock.
    const panel = (deletedAt: number | null, markers = MARKERS) => (
      <Harness
        onJump={jest.fn()}
        onRename={jest.fn()}
        onDelete={jest.fn()}
        onShow={jest.fn()}
        startNaming={null}
        markers={markers}
        refusal={null}
        deletedAt={deletedAt}
        onUndo={jest.fn()}
        onClose={jest.fn()}
      />
    );

    it('fades and closes the row, with no Undo in it, and then the row is gone', () => {
      const { rerender } = render(panel(5));
      rerender(panel(null));
      const leaving = document.querySelector('.DraftDeleted');
      expect(leaving).toHaveClass('leaving');
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
      act(() => {
        jest.advanceTimersByTime(LEAVE_MS);
      });
      expect(document.querySelector('.DraftDeleted')).toBeNull();
      expect(names()).toEqual(['xv', 'zq', 'Draft 2']);
    });

    it('closes no row for a draft that was put back', () => {
      const { rerender } = render(panel(5));
      rerender(panel(null, [...MARKERS, { index: 5, label: 'qv' }]));
      expect(document.querySelector('.DraftDeleted')).toBeNull();
      expect(names()).toEqual(['xv', 'zq', 'qv', 'Draft 2']);
    });

    it('closes the first row when a second draft is deleted before it was put back', () => {
      const { rerender } = render(panel(5));
      rerender(
        panel(
          2,
          MARKERS.filter((m) => m.index !== 2)
        )
      );
      const deleted = Array.from(document.querySelectorAll('.DraftDeleted'));
      expect(deleted.map((r) => r.classList.contains('leaving'))).toEqual([
        true,
        false,
      ]);
      expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    });
  });

  it('shows no Undo when there is nothing to undo', () => {
    show();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

// GitHub #117, item 9: the panel is a fixed width, so a name stops at the end of its field.
describe('DraftDrawer: a name fits its field', () => {
  // jsdom lays nothing out, so the field's widths are given: it overflows once its text is longer than `room`.
  const field = (value: string, room: number) =>
    ({
      value,
      clientWidth: room * 10,
      scrollWidth: Math.max(value.length, room) * 10,
    }) as unknown as HTMLInputElement;

  it('takes a letter while the name fits', () => {
    expect(fitsTheField(field('abcd', 4), 'abc')).toBe(true);
  });

  it('refuses a letter that would run past the end', () => {
    expect(fitsTheField(field('abcde', 4), 'abcd')).toBe(false);
  });

  it('never cuts a name already longer than the field, and lets it be shortened', () => {
    expect(fitsTheField(field('abcdefg', 4), 'abcdefgh')).toBe(true);
  });

  it('refuses making a name that is already too long longer still', () => {
    expect(fitsTheField(field('abcdefghi', 4), 'abcdefgh')).toBe(false);
  });

  describe('in the panel', () => {
    const widths = (room: number) => {
      jest
        .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
        .mockImplementation(() => room * 10);
      jest
        .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
        // eslint-disable-next-line no-unused-vars -- the base rule reports the `this` parameter's type
        .mockImplementation(function width(this: HTMLElement) {
          const text = (this as HTMLInputElement).value ?? '';
          return Math.max(text.length, room) * 10;
        });
    };
    afterEach(() => jest.restoreAllMocks());

    it('keeps what was typed up to the end of the field, and no further', () => {
      widths(4);
      show({ startNaming: 7 });
      const input = screen.getByRole('textbox', { name: 'Draft Marker name' });
      fireEvent.change(input, { target: { value: 'abcd' } });
      expect(input).toHaveValue('abcd');
      fireEvent.change(input, { target: { value: 'abcde' } });
      expect(input).toHaveValue('abcd');
    });
  });
});
