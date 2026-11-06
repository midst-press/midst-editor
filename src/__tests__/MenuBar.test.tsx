import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Editor as EditorType } from '@tiptap/core';
import { EditorProvider, useCurrentEditor } from '@tiptap/react';
import { useEffect } from 'react';
import StarterKit from '@tiptap/starter-kit';
import type { ElectronHandler } from 'main/preload';
import MenuBar from '../renderer/components/Editor/MenuBar';
import useFontSize from '../renderer/fontSize/useFontSize';
import {
  PoemSizeContext,
  usePoemSizeState,
} from '../renderer/fontSize/PoemSizeContext';

// A listener of any channel, called as the window would call it.
// eslint-disable-next-line no-unused-vars
type AnyListener = (...args: unknown[]) => void;

type Listener = Parameters<ElectronHandler['ipcRenderer']['on']>[1];

// Synthetic text only.

// jsdom lacks layout APIs that ProseMirror calls when it focuses or scrolls.
beforeAll(() => {
  const rect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
  };
  (Range.prototype as any).getClientRects = () => [];
  (Range.prototype as any).getBoundingClientRect = () => rect;
  (Element.prototype as any).getClientRects = () => [];
  Element.prototype.scrollIntoView = jest.fn();
});

type Call = [string, ...unknown[]];

let calls: Call[];
let values: Record<string, unknown>;
let listeners: Record<string, Listener[]>;
let removed: string[];
let editor: EditorType;

const install = (seed: Record<string, unknown> = {}) => {
  calls = [];
  removed = [];
  listeners = {};
  values = { ...seed };
  (window as unknown as { electron: unknown }).electron = {
    store: {
      get: (key: string) => {
        calls.push(['store.get', key]);
        return values[key];
      },
      set: (key: string, value: unknown) => {
        calls.push(['store.set', key, value]);
        values[key] = value;
      },
    },
    ipcRenderer: {
      sendMessage: (channel: string, args: unknown) => {
        calls.push(['sendMessage', channel, args]);
      },
      on: (channel: string, listener: Listener) => {
        calls.push(['on', channel]);
        listeners[channel] = [...(listeners[channel] ?? []), listener];
        return () => {
          removed.push(channel);
        };
      },
      once: jest.fn(),
    },
    titlebar: { updateTitle: jest.fn() },
    log: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
  };
};

beforeEach(() => install());

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron;
});

function Capture() {
  const { editor: current } = useCurrentEditor();
  // In an effect, not during render (react-hooks/globals).
  useEffect(() => {
    if (current) editor = current;
  }, [current]);
  return null;
}

// As App does (#390): the size belongs to the poem and is held above the editor; MenuBar steps it.
function Toolbar({ focused }: { focused: boolean }) {
  return (
    <MenuBar
      focused={focused}
      onToggleFocus={jest.fn()}
      fontSize={useFontSize()}
    />
  );
}

function Host({
  extensions,
  content,
  cls,
  focused,
}: {
  extensions: any[];
  content: string;
  cls: string;
  focused: boolean;
}) {
  return (
    <PoemSizeContext.Provider value={usePoemSizeState()}>
      <EditorProvider
        extensions={extensions}
        content={content}
        editorProps={{ attributes: { class: cls } }}
        slotBefore={<Toolbar focused={focused} />}
        slotAfter={<Capture />}
      />
    </PoemSizeContext.Provider>
  );
}

const mount = ({
  extensions = [StarterKit] as any[],
  content = '<p>synthetic line</p>',
  cls = 'TextEditor editor-height-tall',
  focused = false,
} = {}) =>
  render(
    <Host
      extensions={extensions}
      content={content}
      cls={cls}
      focused={focused}
    />
  );

const storeWrites = () => calls.filter((c) => c[0] === 'store.set');
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const selectAll = () =>
  act(() => {
    editor.commands.selectAll();
  });
const emitStep = (direction: 'up' | 'down') =>
  act(() =>
    listeners['step-font-size'].forEach((l) => (l as AnyListener)(direction))
  );
const poemFontSize = () => JSON.parse(values.meta as string).fontSize;

describe('MenuBar controls', () => {
  it('offers seven buttons with accessible names', () => {
    mount();
    [
      'Increase text size',
      'Decrease text size',
      'Bold',
      'Italic',
      // Underline and strikethrough, since #140 (GitHub #30).
      'Underline',
      'Strikethrough',
      // The moon, since focus mode (GitHub #25).
      'Focus Mode',
    ].forEach((name) =>
      expect(screen.getByRole('button', { name })).toBeEnabled()
    );
    expect(screen.getAllByRole('button')).toHaveLength(7);
  });

  // #140: the two new buttons apply their marks to the selection, and take them off again.
  it.each([
    ['Underline', 'u'],
    ['Strikethrough', 's'],
  ])('%s marks the selection and unmarks it', (name, tag) => {
    mount();
    selectAll();
    click(name);
    expect(editor.getHTML()).toContain(`<${tag}>`);
    click(name);
    expect(editor.getHTML()).not.toContain(`<${tag}>`);
  });
});

describe('MenuBar bold and italic', () => {
  it.each([
    ['Bold', 'strong'],
    ['Italic', 'em'],
  ])('%s wraps the selection and toggles back', (name, tag) => {
    mount();
    selectAll();
    click(name);
    expect(editor.getHTML()).toBe(`<p><${tag}>synthetic line</${tag}></p>`);
    click(name);
    expect(editor.getHTML()).toBe('<p>synthetic line</p>');
  });

  it.each([
    ['Bold', 'strong'],
    ['Italic', 'em'],
  ])('%s marks only the selected range', (name, tag) => {
    mount();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 10 });
    });
    click(name);
    expect(editor.getHTML()).toBe(`<p><${tag}>synthetic</${tag}> line</p>`);
  });

  it('bold and italic combine on the same text', () => {
    mount();
    selectAll();
    click('Bold');
    click('Italic');
    expect(editor.isActive('bold')).toBe(true);
    expect(editor.isActive('italic')).toBe(true);
    expect(editor.getHTML()).toContain('synthetic line');
    expect(editor.getHTML()).toMatch(/<strong>.*<em>|<em>.*<strong>/);
  });

  it('marks the button is-active only while its mark is active', () => {
    mount();
    selectAll();
    const bold = screen.getByRole('button', { name: 'Bold' });
    const italic = screen.getByRole('button', { name: 'Italic' });
    expect(bold).not.toHaveClass('is-active');
    click('Bold');
    expect(bold).toHaveClass('is-active');
    expect(italic).not.toHaveClass('is-active');
    click('Bold');
    expect(bold).not.toHaveClass('is-active');
  });

  it('reflects marks already present in the document', () => {
    mount({ content: '<p><em>synthetic line</em></p>' });
    selectAll();
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveClass(
      'is-active'
    );
    expect(screen.getByRole('button', { name: 'Bold' })).not.toHaveClass(
      'is-active'
    );
  });

  it('does not touch the store', () => {
    mount();
    selectAll();
    click('Bold');
    click('Italic');
    expect(storeWrites()).toEqual([]);
  });

  it('disables both buttons where the document does not allow the marks (code block)', () => {
    mount({ content: '<pre><code>synthetic code</code></pre>' });
    selectAll();
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Italic' })).toBeDisabled();
  });
});

// The stepping itself, and what it writes, is PoemSizeContext.test.tsx's; these are the toolbar's buttons (#390).
describe('MenuBar text size', () => {
  const button = (name: string) => screen.getByRole('button', { name });

  it('starts at 16 when nothing is stored, with both buttons enabled', () => {
    mount();
    expect(button('Increase text size')).toBeEnabled();
    expect(button('Decrease text size')).toBeEnabled();
  });

  it("increase and decrease step the poem's size", () => {
    install({ 'font-size': '20' });
    mount();
    click('Increase text size');
    expect(poemFontSize()).toBe(24);
    click('Decrease text size');
    click('Decrease text size');
    expect(poemFontSize()).toBe(16);
    expect(values['font-size']).toBe('16');
  });

  it('leaves the editor surface without a size class', () => {
    const { container } = mount();
    click('Increase text size');
    expect(container.querySelector('.ProseMirror')?.className).not.toMatch(
      /size-/
    );
  });

  it.each([
    ['36', 'Increase text size', 'Decrease text size'],
    ['10', 'Decrease text size', 'Increase text size'],
  ])(
    'at %s disables only the limit button, which then writes nothing',
    (stored, off, on) => {
      install({ 'font-size': stored });
      mount();
      expect(button(off)).toBeDisabled();
      expect(button(on)).toBeEnabled();
      fireEvent.click(button(off));
      expect(storeWrites()).toEqual([]);
    }
  );

  it('re-enables a limit button after stepping away from the limit', () => {
    install({ 'font-size': '36' });
    mount();
    expect(button('Increase text size')).toBeDisabled();
    click('Decrease text size');
    expect(button('Increase text size')).toBeEnabled();
  });

  it('does not itself write the store on mount', () => {
    install({ 'font-size': '20' });
    mount();
    expect(storeWrites()).toEqual([]);
  });
});

describe("MenuBar and the View menu's step-font-size", () => {
  it('the size is subscribed once, above the toolbar, and unsubscribed on unmount', () => {
    const { unmount } = mount();
    expect(
      calls.filter((c) => c[0] === 'on' && c[1] === 'step-font-size')
    ).toHaveLength(1);
    unmount();
    expect(removed).toContain('step-font-size');
  });

  it("updates which buttons are disabled, and later presses continue from the menu's step", () => {
    install({ 'font-size': '32' });
    mount();
    emitStep('up');
    expect(
      screen.getByRole('button', { name: 'Increase text size' })
    ).toBeDisabled();
    click('Decrease text size');
    expect(poemFontSize()).toBe(32);
  });
});

// #284, GitHub #66: a button that cannot be used says why, in its tooltip and its description, and looks unavailable.
describe('MenuBar: a button that cannot be used says why', () => {
  const button = (name: string) => screen.getByRole('button', { name });

  it.each([
    [
      '36',
      'Increase text size',
      'The text is already at its largest size.',
      'Decrease text size',
    ],
    [
      '10',
      'Decrease text size',
      'The text is already at its smallest size.',
      'Increase text size',
    ],
  ])(
    'at size %s, %s says so; the other button does not',
    (stored, off, reason, on) => {
      install({ 'font-size': stored });
      mount();
      expect(button(off)).toHaveAccessibleDescription(reason);
      expect(button(off)).toHaveStyle({ opacity: '0.38' });
      expect(button(on)).toHaveAccessibleDescription('');
      expect(button(on)).not.toHaveStyle({ opacity: '0.38' });
    }
  );

  it('in a code block, Bold and Italic say they cannot be used here', () => {
    mount({ content: '<pre><code>synthetic code</code></pre>' });
    selectAll();
    expect(button('Bold')).toHaveAccessibleDescription(
      "Bold can't be used in this part of the poem."
    );
    expect(button('Italic')).toHaveAccessibleDescription(
      "Italic can't be used in this part of the poem."
    );
    expect(button('Bold')).toHaveStyle({ opacity: '0.38' });
  });

  it('where every button can be used, none has a reason or looks unavailable', () => {
    mount();
    ['Increase text size', 'Decrease text size', 'Bold', 'Italic'].forEach(
      (name) => {
        expect(button(name)).toHaveAccessibleDescription('');
        expect(button(name)).not.toHaveStyle({ opacity: '0.38' });
      }
    );
  });

  it('shows the reason in a tooltip over a disabled button', async () => {
    install({ 'font-size': '36' });
    mount();
    fireEvent.mouseOver(
      button('Increase text size').parentElement as HTMLElement
    );
    expect(
      await screen.findByRole('tooltip', {}, { timeout: 3000 })
    ).toHaveTextContent('The text is already at its largest size.');
  });
});

describe('MenuBar focus mode (GitHub #25)', () => {
  const button = (name: string) =>
    screen.getByRole('button', { name: new RegExp(`^${name}$`) });

  it('shows the moon after the font options, separated by a gap', () => {
    mount();
    const bar = document.querySelector('.TopButtons') as HTMLElement;
    const names = Array.from(bar.querySelectorAll('button[aria-label]')).map(
      (b) => b.getAttribute('aria-label')
    );
    expect(names).toEqual([
      'Increase text size',
      'Decrease text size',
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Focus Mode',
    ]);
    // Two gaps: one between size and styling, one between styling and the moon (GitHub #25, #432, #462).
    const gaps = bar.querySelectorAll('.focus-mode-gap, .focus-mode-gap-wide');
    expect(gaps).toHaveLength(2);
    gaps.forEach((gap) => {
      expect(gap.textContent).toBe('');
    });
    const label = (n: Element) =>
      n.classList.contains('focus-mode-gap') ||
      n.classList.contains('focus-mode-gap-wide')
        ? 'gap'
        : (n.getAttribute('aria-label') ?? 'other');
    const inOrder = Array.from(
      bar.querySelectorAll(
        '.focus-mode-gap, .focus-mode-gap-wide, button[aria-label="Focus Mode"], button[aria-label="Increase text size"], button[aria-label="Bold"]'
      )
    )
      .map(label)
      .join(',');
    expect(inOrder).toBe('Increase text size,gap,Bold,gap,Focus Mode');
  });

  it('in focus mode the moon is the only control, and its tooltip says what it restores', async () => {
    mount({ focused: true });
    const bar = document.querySelector('.TopButtons') as HTMLElement;
    // The gap goes with the font options it separates them from: focus mode hides every
    // interface option except the moon (GitHub #25), and an invisible 12px gap is none.
    expect(bar.querySelectorAll('button')).toHaveLength(1);
    expect(bar.querySelector('.focus-mode-gap')).toBeNull();
    expect(button('Focus Mode')).toBeInTheDocument();
    expect(button('Focus Mode')).toHaveAttribute('aria-pressed', 'true');
    // MUI renders a tooltip's words only when it opens; the contract is that they exist
    // when asked for (the availability reasons in the tests above follow the same shape).
    fireEvent.mouseOver(button('Focus Mode'));
    expect(
      await screen.findByRole('tooltip', {}, { timeout: 3000 })
    ).toHaveTextContent('Bring the controls back');
  });

  it('clicking the moon asks main, once, and never touches the store', () => {
    const onToggleFocus = jest.fn();
    render(
      <EditorProvider
        extensions={[StarterKit] as any[]}
        content="<p>synthetic line</p>"
        slotBefore={
          <MenuBar
            focused={false}
            onToggleFocus={onToggleFocus}
            fontSize={{
              size: 2,
              increase: jest.fn(),
              decrease: jest.fn(),
              canIncrease: true,
              canDecrease: true,
            }}
          />
        }
      />
    );
    fireEvent.click(button('Focus Mode'));
    expect(onToggleFocus).toHaveBeenCalledTimes(1);
    // Focus mode is never saved with the poem (GitHub #25): the renderer must not store it.
    expect(storeWrites()).toEqual([]);
  });
});
