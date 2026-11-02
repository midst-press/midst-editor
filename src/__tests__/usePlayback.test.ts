import { act, renderHook } from '@testing-library/react';
import { MutableRefObject } from 'react';
import { Glide } from '@midst-press/midst-format/follow';
import usePlayback from '../renderer/components/Replay/usePlayback';

// The last frame follows the history (#356): maxStep was once frozen at mount. Cora, review of the design:
// a playhead at the end follows a growing history; one earlier stays put.

const noGlide = { current: null } as MutableRefObject<Glide | null>;
const mount = (maxStep: number) =>
  renderHook(({ max }) => usePlayback(max, noGlide), {
    initialProps: { max: maxStep },
  });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('usePlayback when the history changes', () => {
  it('starts at the last frame', () => {
    expect(mount(5).result.current.step).toBe(5);
  });

  it('follows a growing history when it was at the end', () => {
    const view = mount(5);
    view.rerender({ max: 8 });
    expect(view.result.current.step).toBe(8);
  });

  it('stays put when a growing history finds it earlier', () => {
    const view = mount(5);
    act(() => view.result.current.setStep(2));
    view.rerender({ max: 8 });
    expect(view.result.current.step).toBe(2);
  });

  it('moves to the new end when the history shrinks below it, and stops playing', () => {
    const view = mount(8);
    act(() => view.result.current.setStep(6));
    act(() => view.result.current.play());
    expect(view.result.current.playing).toBe(true);
    view.rerender({ max: 3 });
    expect(view.result.current.step).toBe(3);
    expect(view.result.current.playing).toBe(false);
  });

  it('keeps its frame when the history shrinks to above it', () => {
    const view = mount(8);
    act(() => view.result.current.setStep(2));
    view.rerender({ max: 5 });
    expect(view.result.current.step).toBe(2);
  });

  it('plays on to the new end of a history that grew while playing', () => {
    const view = mount(4);
    act(() => view.result.current.setStep(0));
    act(() => view.result.current.play());
    view.rerender({ max: 6 });
    act(() => {
      jest.advanceTimersByTime(60 * 10);
    });
    expect(view.result.current.step).toBe(6);
    expect(view.result.current.playing).toBe(false);
  });
});
