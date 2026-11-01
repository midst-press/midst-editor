import { fireEvent, renderHook } from '@testing-library/react';
import useReplayKeys from '../renderer/components/Replay/useReplayKeys';

// Replay's keys (#374, GitHub #98): Space only plays or pauses, cancelled so a focused control does not take it
// too; Enter belongs to a focused control; a control clicked with the mouse gives the focus up.
function setUp() {
  document.body.innerHTML = `
    <button id="play">Play</button>
    <button id="follow">Follow</button>
    <input id="slider" type="range" />
    <input id="switch" type="checkbox" />
    <input id="name" type="text" />
    <textarea id="notes"></textarea>
    <div id="page"></div>`;
  const play = document.getElementById('play') as HTMLButtonElement;
  const plays = jest.fn();
  play.addEventListener('click', plays);
  const closeDrafts = jest.fn();
  const backToEdit = jest.fn();
  const hook = renderHook(() =>
    useReplayKeys({ current: play }, closeDrafts, backToEdit)
  );
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  return { plays, closeDrafts, backToEdit, hook, el };
}

const press = (target: HTMLElement, init: KeyboardEventInit) =>
  fireEvent.keyDown(target, init);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useReplayKeys: Space', () => {
  it('plays or pauses from the page or the slider, and is cancelled', () => {
    const { plays, el } = setUp();
    ['page', 'slider'].forEach((id) => {
      expect(press(el(id), { key: ' ' })).toBe(false); // false: the default was prevented
    });
    expect(plays).toHaveBeenCalledTimes(2);
  });

  it('belongs to a focused button or switch, which only the keyboard leaves focused', () => {
    const { plays, el } = setUp();
    ['follow', 'switch'].forEach((id) => {
      expect(press(el(id), { key: ' ' })).toBe(true);
    });
    expect(plays).not.toHaveBeenCalled();
  });

  it('plays with the drafts list open too', () => {
    const { plays, el } = setUp();
    el('page').classList.add('DraftDrawer');
    press(el('page'), { key: ' ' });
    expect(plays).toHaveBeenCalledTimes(1);
  });

  it('counts a held key once', () => {
    const { plays, el } = setUp();
    expect(press(el('page'), { key: ' ', repeat: true })).toBe(false);
    expect(plays).not.toHaveBeenCalled();
  });

  it('leaves text entry, and modified Space, alone', () => {
    const { plays, el } = setUp();
    expect(press(el('name'), { key: ' ' })).toBe(true);
    expect(press(el('notes'), { key: ' ' })).toBe(true);
    ['metaKey', 'ctrlKey', 'altKey'].forEach((mod) => {
      expect(press(el('page'), { key: ' ', [mod]: true })).toBe(true);
    });
    expect(plays).not.toHaveBeenCalled();
  });
});

describe('useReplayKeys: Enter', () => {
  it('belongs to a focused control, and plays from the page or the slider', () => {
    const { plays, el } = setUp();
    expect(press(el('follow'), { key: 'Enter' })).toBe(true);
    expect(press(el('switch'), { key: 'Enter' })).toBe(true);
    expect(plays).not.toHaveBeenCalled();
    expect(press(el('page'), { key: 'Enter' })).toBe(false);
    expect(press(el('slider'), { key: 'Enter' })).toBe(false);
    expect(plays).toHaveBeenCalledTimes(2);
  });

  it('counts a held key once, and belongs to the drafts list while it is open', () => {
    const { plays, el } = setUp();
    press(el('page'), { key: 'Enter', repeat: true });
    el('page').classList.add('DraftDrawer');
    expect(press(el('page'), { key: 'Enter' })).toBe(true);
    expect(plays).not.toHaveBeenCalled();
  });
});

describe('useReplayKeys: Escape', () => {
  it('closes the drafts list, saying whether it came from inside it', () => {
    const { closeDrafts, backToEdit, el } = setUp();
    el('page').classList.add('DraftDrawer');
    press(el('page'), { key: 'Escape' });
    press(el('follow'), { key: 'Escape' });
    expect(closeDrafts.mock.calls).toEqual([[true], [false]]);
    expect(backToEdit).not.toHaveBeenCalled();
  });

  it('goes back to Edit, except from text entry, which keeps it', () => {
    const { backToEdit, el } = setUp();
    press(el('name'), { key: 'Escape' });
    expect(backToEdit).not.toHaveBeenCalled();
    press(el('follow'), { key: 'Escape' });
    expect(backToEdit).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const { plays, backToEdit, el } = setUp();
    press(el('page'), { key: 'a' });
    expect(plays).not.toHaveBeenCalled();
    expect(backToEdit).not.toHaveBeenCalled();
  });
});

describe('useReplayKeys: focus after a click', () => {
  it('a mouse click gives up the focus of a button or a switch', () => {
    const { el } = setUp();
    ['follow', 'switch'].forEach((id) => {
      el(id).focus();
      fireEvent.click(el(id), { detail: 1 });
      expect(document.activeElement).toBe(document.body);
    });
  });

  it('a click from the keyboard keeps the focus', () => {
    const { el } = setUp();
    el('follow').focus();
    fireEvent.click(el('follow'), { detail: 0 });
    expect(document.activeElement).toBe(el('follow'));
  });

  it('leaves the focus alone when the control already moved it, or the click was not on a control', () => {
    const { el } = setUp();
    el('name').focus();
    fireEvent.click(el('follow'), { detail: 1 });
    expect(document.activeElement).toBe(el('name'));
    fireEvent.click(el('page'), { detail: 1 });
    expect(document.activeElement).toBe(el('name'));
  });

  it('stops listening when unmounted', () => {
    const { plays, hook, el } = setUp();
    hook.unmount();
    press(el('page'), { key: ' ' });
    expect(plays).not.toHaveBeenCalled();
  });
});
