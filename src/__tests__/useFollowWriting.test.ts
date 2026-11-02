import { act, renderHook } from '@testing-library/react';
import { MutableRefObject } from 'react';
import { Editor } from '@tiptap/react';
import { Glide } from '@midst-press/midst-format/follow';
import useFollowWriting from '../renderer/components/Replay/useFollowWriting';

// Following the writing in Replay (#356 moved it out of index.tsx). There is no layout here, so the
// scrolling module is replaced: what is tested is when the view is asked to glide, and that turning Follow
// off mid-glide stops it.
const mockFollow = {
  scrollParent: jest.fn(),
  targetScrollTop: jest.fn(),
  glideTo: jest.fn(),
  gliding: jest.fn(),
};
jest.mock('@midst-press/midst-format/follow', () => ({
  scrollParent: (...a: unknown[]) => mockFollow.scrollParent(...a),
  targetScrollTop: (...a: unknown[]) => mockFollow.targetScrollTop(...a),
  glideTo: (...a: unknown[]) => mockFollow.glideTo(...a),
  gliding: (...a: unknown[]) => mockFollow.gliding(...a),
}));

const scroller = {
  getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
  scrollTop: 0,
  scrollHeight: 500,
};
// An editor whose content changes at position 3 every time it is set.
const fakeEditor = () => {
  let n = 0;
  const doc = () => ({
    content: { findDiffStart: () => (n > 0 ? 3 : null), size: 10 },
  });
  return {
    get state() {
      return { doc: doc() };
    },
    commands: {
      setContent: jest.fn(() => {
        n += 1;
      }),
    },
    view: { dom: {}, coordsAtPos: jest.fn(() => ({ top: 40, bottom: 50 })) },
  } as unknown as Editor;
};

let stored: Record<string, string> = {};
beforeEach(() => {
  stored = {};
  Object.values(mockFollow).forEach((f) => f.mockReset());
  mockFollow.scrollParent.mockReturnValue(scroller);
  mockFollow.targetScrollTop.mockReturnValue(120);
  mockFollow.glideTo.mockReturnValue({ frame: 7 });
  (window as unknown as { electron: unknown }).electron = {
    store: {
      get: (k: string) => stored[k],
      set: (k: string, v: string) => {
        stored[k] = v;
      },
    },
  };
});

const glideRef = () => ({ current: null }) as MutableRefObject<Glide | null>;

describe('useFollowWriting', () => {
  it('puts each frame into the editor and glides to where it changed, with Follow on', () => {
    const editor = fakeEditor();
    const glide = glideRef();
    const view = renderHook(
      ({ step }) => useFollowWriting(editor, [], step, glide),
      {
        initialProps: { step: 0 },
      }
    );
    view.rerender({ step: 1 });
    expect(editor.commands.setContent).toHaveBeenCalledTimes(2);
    expect(mockFollow.glideTo).toHaveBeenCalledWith(scroller, 120, null);
    expect(glide.current).toEqual({ frame: 7 });
  });

  it('does not glide with Follow off', () => {
    stored['replay-autoscroll'] = 'false';
    const editor = fakeEditor();
    const view = renderHook(
      ({ step }) => useFollowWriting(editor, [], step, glideRef()),
      {
        initialProps: { step: 0 },
      }
    );
    view.rerender({ step: 1 });
    expect(view.result.current.on).toBe(false);
    expect(mockFollow.glideTo).not.toHaveBeenCalled();
  });

  it('does not glide when nothing on the page would move', () => {
    mockFollow.targetScrollTop.mockReturnValue(null);
    const view = renderHook(
      ({ step }) => useFollowWriting(fakeEditor(), [], step, glideRef()),
      {
        initialProps: { step: 0 },
      }
    );
    view.rerender({ step: 1 });
    expect(mockFollow.glideTo).not.toHaveBeenCalled();
  });

  it('stops a glide under way when Follow is turned off, and remembers the choice', () => {
    mockFollow.gliding.mockReturnValue(true);
    const cancel = jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {});
    const glide = glideRef();
    glide.current = { frame: 7 } as unknown as Glide;
    const view = renderHook(() => useFollowWriting(null, [], 0, glide));
    act(() => view.result.current.toggle());
    expect(cancel).toHaveBeenCalledWith(7);
    expect(glide.current).toBeNull();
    expect(stored['replay-autoscroll']).toBe('false');
    cancel.mockRestore();
  });

  it('leaves the glide alone when Follow is turned on', () => {
    stored['replay-autoscroll'] = 'false';
    const glide = glideRef();
    glide.current = { frame: 7 } as unknown as Glide;
    const view = renderHook(() => useFollowWriting(null, [], 0, glide));
    act(() => view.result.current.toggle());
    expect(view.result.current.on).toBe(true);
    expect(glide.current).toEqual({ frame: 7 });
  });
});
