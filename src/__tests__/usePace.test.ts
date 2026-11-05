import { act, renderHook } from '@testing-library/react';
import { MutableRefObject } from 'react';
import { Glide } from '@midst-press/midst-format/follow';
import usePace, {
  FPS,
  paceFromStore,
  SCROLL_SPEED,
} from '../renderer/components/Replay/usePace';
import usePlayback, {
  FRAME_MS,
} from '../renderer/components/Replay/usePlayback';

// The Timeline's frame-rate and scroll-speed settings (Annelyse, GitHub #49; editor #427). Their defaults are
// today's pace, a set value is remembered, and the frame rate is the rate playback steps at.

let stored: Record<string, string>;
beforeEach(() => {
  stored = {};
  (window as unknown as { electron: unknown }).electron = {
    store: {
      get: (key: string) => stored[key],
      set: (key: string, value: string) => {
        stored[key] = value;
      },
    },
  };
});

describe('the pace defaults are today’s pace', () => {
  it('the frame rate starts at one frame every FRAME_MS (60ms)', () => {
    expect(FRAME_MS).toBe(60);
    expect(1000 / FPS.initial).toBeCloseTo(FRAME_MS, 9);
  });

  it('the scroll speed starts at midst-format’s 5 viewports a second', () => {
    expect(SCROLL_SPEED.initial).toBe(5);
  });

  it.each([undefined, '', 'fast', '0', '61', 'NaN'])(
    'a stored frame rate of %p gives the default',
    (value) => {
      expect(paceFromStore(FPS, value)).toBe(FPS.initial);
    }
  );

  it('a stored value inside the range is used', () => {
    expect(paceFromStore(FPS, '30')).toBe(30);
    expect(paceFromStore(SCROLL_SPEED, '12.5')).toBe(12.5);
  });
});

describe('usePace', () => {
  it('starts from the store, and remembers what is set', () => {
    stored['replay-scroll-speed'] = '8';
    const { result } = renderHook(() => usePace(SCROLL_SPEED));
    expect(result.current.value).toBe(8);
    act(() => result.current.set(2.5));
    expect(result.current.value).toBe(2.5);
    expect(stored['replay-scroll-speed']).toBe('2.5');
  });

  it('ignores a value outside the range', () => {
    const { result } = renderHook(() => usePace(FPS));
    act(() => result.current.set(0));
    expect(result.current.value).toBe(FPS.initial);
    expect(stored['replay-fps']).toBeUndefined();
  });
});

describe('playback steps at the frame rate', () => {
  const noGlide = { current: null } as MutableRefObject<Glide | null>;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const mount = (frameMs?: number) =>
    renderHook(({ ms }) => usePlayback(100, noGlide, ms), {
      initialProps: { ms: frameMs },
    });
  const playFor = (view: ReturnType<typeof mount>, ms: number) => {
    act(() => view.result.current.setStep(0));
    act(() => view.result.current.play());
    act(() => {
      jest.advanceTimersByTime(ms);
    });
    return view.result.current.step;
  };

  it('with no frame rate given, one frame every 60ms, as before', () => {
    expect(playFor(mount(), 600)).toBe(10);
  });

  it('at 5 frames a second, one frame every 200ms', () => {
    expect(playFor(mount(1000 / 5), 1000)).toBe(5);
  });

  it('a new frame rate while playing takes effect from the frame shown', () => {
    const view = mount(FRAME_MS);
    expect(playFor(view, 600)).toBe(10);
    view.rerender({ ms: 200 });
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(view.result.current.step).toBe(15);
  });
});
