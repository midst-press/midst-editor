import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import DraftDrawer from '../renderer/components/DraftMarkers/DraftDrawer';

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
}

function Harness({
  onJump,
  onRename,
  onDelete,
  onShow,
  startNaming,
  markers,
}: HarnessProps) {
  const [naming, setNaming] = useState<number | null>(startNaming);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  return (
    <DraftDrawer
      open
      onClose={jest.fn()}
      markers={markers}
      naming={naming}
      setNaming={setNaming}
      onJump={onJump}
      onRename={onRename}
      onDelete={onDelete}
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
    />
  );

const names = () =>
  Array.from(document.querySelectorAll('.DraftDrawer .draft-name')).map(
    (b) => b.textContent
  );

describe('DraftDrawer', () => {
  it('lists the drafts newest first', () => {
    show();
    expect(names()).toEqual(['xv', 'Draft 2', 'zq']);
  });

  it('says so when there are no drafts', () => {
    show({ markers: [] });
    expect(screen.getByText('No drafts marked yet.')).toBeInTheDocument();
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
    fireEvent.click(screen.getAllByLabelText('Rename draft')[2]);
    const field = screen.getByLabelText('Draft name') as HTMLInputElement;
    expect(field.value).toBe('zq');
    fireEvent.change(field, { target: { value: 'qz vx' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(7, 'qz vx');
    expect(screen.queryByLabelText('Draft name')).toBeNull();
  });

  it('saves the name when the field is left', () => {
    const onRename = jest.fn();
    show({ onRename, startNaming: 2 });
    const field = screen.getByLabelText('Draft name') as HTMLInputElement;
    expect(field.value).toBe('Draft 2');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(onRename).toHaveBeenCalledWith(2, '');
  });

  it('leaves the name alone on Escape', () => {
    const onRename = jest.fn();
    show({ onRename, startNaming: 7 });
    const field = screen.getByLabelText('Draft name');
    fireEvent.change(field, { target: { value: 'qz' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(names()).toContain('zq');
  });

  it('deletes at once, and does not rename the draft being deleted', () => {
    const onDelete = jest.fn();
    const onRename = jest.fn();
    show({ onDelete, onRename, startNaming: 30 });
    fireEvent.click(screen.getAllByLabelText('Delete draft')[0]);
    expect(onDelete).toHaveBeenCalledWith(30);
    expect(onRename).not.toHaveBeenCalled();
  });

  it('switches the timeline markers and their names on and off', () => {
    const onShow = jest.fn();
    show({ onShow });
    fireEvent.click(screen.getByLabelText('Show markers on the timeline'));
    fireEvent.click(screen.getByLabelText('Show their names'));
    expect(onShow.mock.calls).toEqual([
      ['markers', false],
      ['labels', false],
    ]);
  });
});
