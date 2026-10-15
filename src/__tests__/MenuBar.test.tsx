import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Editor as EditorType } from '@tiptap/core';
import { EditorProvider, useCurrentEditor } from '@tiptap/react';
import { useEffect } from 'react';
import StarterKit from '@tiptap/starter-kit';
import type { ElectronHandler } from 'main/preload';
import MenuBar from '../renderer/components/Editor/MenuBar';

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

const mount = ({
  extensions = [StarterKit] as any[],
  content = '<p>synthetic line</p>',
  cls = 'TextEditor editor-height-tall size-2',
} = {}) =>
  render(
    <EditorProvider
      extensions={extensions}
      content={content}
      editorProps={{ attributes: { class: cls } }}
      slotBefore={<MenuBar />}
      slotAfter={<Capture />}
    />
  );

const storeWrites = () => calls.filter((c) => c[0] === 'store.set');
const editorClass = () =>
  (editor.options.editorProps.attributes as Record<string, string>).class;
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const selectAll = () =>
  act(() => {
    editor.commands.selectAll();
  });
const emitSetFontSize = (size: unknown) =>
  act(() => listeners['set-font-size'].forEach((l) => l(size)));

describe('MenuBar controls', () => {
  it('offers four buttons with accessible names', () => {
    mount();
    ['Increase text size', 'Decrease text size', 'Bold', 'Italic'].forEach(
      (name) => expect(screen.getByRole('button', { name })).toBeEnabled()
    );
    expect(screen.getAllByRole('button')).toHaveLength(4);
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

describe('MenuBar text size', () => {
  it('starts at size 2 when nothing is stored, with both buttons enabled', () => {
    mount();
    expect(
      screen.getByRole('button', { name: 'Increase text size' })
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Decrease text size' })
    ).toBeEnabled();
    expect(calls).toContainEqual(['store.get', 'font-size']);
  });

  it('increase writes the next size as a string and sets the size class', () => {
    install({ 'font-size': '2' });
    mount();
    click('Increase text size');
    expect(storeWrites()).toEqual([['store.set', 'font-size', '3']]);
    expect(editorClass()).toBe('TextEditor editor-height-tall size-3');
  });

  it('decrease writes the previous size as a string and sets the size class', () => {
    install({ 'font-size': '2' });
    mount();
    click('Decrease text size');
    expect(storeWrites()).toEqual([['store.set', 'font-size', '1']]);
    expect(editorClass()).toBe('TextEditor editor-height-tall size-1');
  });

  it('keeps unrelated classes and replaces only the size class', () => {
    mount({ cls: 'alpha size-2 beta' });
    click('Increase text size');
    expect(editorClass().split(' ').sort()).toEqual(
      ['alpha', 'beta', 'size-3'].sort()
    );
  });

  it('applies the size class to the rendered editor surface', () => {
    const { container } = mount();
    click('Increase text size');
    expect(container.querySelector('.ProseMirror')).toHaveClass('size-3');
    expect(container.querySelector('.ProseMirror')).not.toHaveClass('size-2');
  });

  it('steps up successively to 4, then disables increase and stops writing', () => {
    install({ 'font-size': '2' });
    mount();
    click('Increase text size');
    click('Increase text size');
    expect(storeWrites()).toEqual([
      ['store.set', 'font-size', '3'],
      ['store.set', 'font-size', '4'],
    ]);
    const inc = screen.getByRole('button', { name: 'Increase text size' });
    expect(inc).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Decrease text size' })
    ).toBeEnabled();
    fireEvent.click(inc);
    expect(storeWrites()).toHaveLength(2);
    expect(editorClass()).toContain('size-4');
  });

  it('steps down successively to 0, then disables decrease and stops writing', () => {
    install({ 'font-size': '2' });
    mount();
    click('Decrease text size');
    click('Decrease text size');
    expect(storeWrites()).toEqual([
      ['store.set', 'font-size', '1'],
      ['store.set', 'font-size', '0'],
    ]);
    const dec = screen.getByRole('button', { name: 'Decrease text size' });
    expect(dec).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Increase text size' })
    ).toBeEnabled();
    fireEvent.click(dec);
    expect(storeWrites()).toHaveLength(2);
    expect(editorClass()).toContain('size-0');
  });

  it('re-enables a limit button after stepping away from the limit', () => {
    install({ 'font-size': '4' });
    mount();
    expect(
      screen.getByRole('button', { name: 'Increase text size' })
    ).toBeDisabled();
    click('Decrease text size');
    expect(
      screen.getByRole('button', { name: 'Increase text size' })
    ).toBeEnabled();
  });

  it.each([
    ['0', 'Decrease text size', 'Increase text size'],
    ['4', 'Increase text size', 'Decrease text size'],
  ])('stored size %s disables only the limit button', (stored, off, on) => {
    install({ 'font-size': stored });
    mount();
    expect(screen.getByRole('button', { name: off })).toBeDisabled();
    expect(screen.getByRole('button', { name: on })).toBeEnabled();
  });

  it('accepts a stored size that is a number rather than a string', () => {
    install({ 'font-size': 0 });
    mount();
    expect(
      screen.getByRole('button', { name: 'Decrease text size' })
    ).toBeDisabled();
  });

  it.each([['9'], ['-1'], ['abc'], ['2.5']])(
    'falls back to size 2 for unsupported stored value %j',
    (stored) => {
      install({ 'font-size': stored });
      mount();
      click('Increase text size');
      expect(storeWrites()).toEqual([['store.set', 'font-size', '3']]);
    }
  );

  it('falls back to size 2 for an empty stored value', () => {
    install({ 'font-size': '' });
    mount();
    click('Decrease text size');
    expect(storeWrites()).toEqual([['store.set', 'font-size', '1']]);
  });

  it('does not itself write the store on mount', () => {
    install({ 'font-size': '3' });
    mount();
    expect(storeWrites()).toEqual([]);
  });
});

describe('MenuBar set-font-size message from the main process', () => {
  it('subscribes once to set-font-size and unsubscribes on unmount', () => {
    const { unmount } = mount();
    expect(calls.filter((c) => c[0] === 'on')).toEqual([
      ['on', 'set-font-size'],
    ]);
    expect(removed).toEqual([]);
    unmount();
    expect(removed).toEqual(['set-font-size']);
  });

  it('applies the size class without writing the store', () => {
    mount();
    emitSetFontSize('4');
    expect(editorClass()).toBe('TextEditor editor-height-tall size-4');
    expect(storeWrites()).toEqual([]);
  });

  it('updates which buttons are disabled', () => {
    mount();
    emitSetFontSize('4');
    expect(
      screen.getByRole('button', { name: 'Increase text size' })
    ).toBeDisabled();
    emitSetFontSize(0);
    expect(
      screen.getByRole('button', { name: 'Decrease text size' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Increase text size' })
    ).toBeEnabled();
  });

  it('later button presses continue from the size the message set', () => {
    mount();
    emitSetFontSize('4');
    click('Decrease text size');
    expect(storeWrites()).toEqual([['store.set', 'font-size', '3']]);
    expect(editorClass()).toContain('size-3');
  });
});
