import { act, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import type { ElectronHandler } from 'main/preload';
import { i18n } from '../shared/i18n';
import { LocaleContext, useMenuLocale } from '../renderer/locale';

// Only English is compiled, so a second language is stood in for here: 'zq', with one word.
jest.mock('../shared/i18n', () => {
  const actual = jest.requireActual('../shared/i18n');
  return {
    ...actual,
    activateLocale: (locale: string) => {
      const used = locale === 'zq' ? 'zq' : 'en';
      actual.i18n.loadAndActivate({
        locale: used,
        messages: used === 'zq' ? { 'drafts.title': 'ZQ' } : actual.catalogs.en,
      });
      return used;
    },
  };
});

type Listener = Parameters<ElectronHandler['ipcRenderer']['on']>[1];
let listeners: Record<string, Listener[]>;

beforeEach(() => {
  listeners = {};
  (window as unknown as { electron: unknown }).electron = {
    ipcRenderer: {
      on: (channel: string, listener: Listener) => {
        (listeners[channel] ??= []).push(listener);
        return () => {
          listeners[channel] = listeners[channel].filter((l) => l !== listener);
        };
      },
    },
  };
});

afterEach(() => {
  jest.requireActual('../shared/i18n').activateLocale('en');
});

// A word read in render, below the provider, as the window's components read theirs.
function Word() {
  const locale = useContext(LocaleContext);
  return (
    <p>
      {locale}: {i18n._('drafts.title')}
    </p>
  );
}

function Window() {
  const locale = useMenuLocale();
  return (
    <LocaleContext.Provider value={locale}>
      <Word />
    </LocaleContext.Provider>
  );
}

describe('useMenuLocale (editor #265)', () => {
  it('starts in the language active at launch, and sets the document language', () => {
    render(<Window />);
    expect(screen.getByText('en: Drafts')).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it("re-renders the window's words in the language the menu sends", () => {
    render(<Window />);
    act(() => listeners['set-locale'].forEach((l) => l('zq')));
    expect(screen.getByText('zq: ZQ')).toBeTruthy();
    expect(document.documentElement.lang).toBe('zq');
  });

  it('shows English for a language with no catalog', () => {
    render(<Window />);
    act(() => listeners['set-locale'].forEach((l) => l('xx')));
    expect(screen.getByText('en: Drafts')).toBeTruthy();
  });

  it('stops listening when the window goes', () => {
    const { unmount } = render(<Window />);
    expect(listeners['set-locale']).toHaveLength(1);
    unmount();
    expect(listeners['set-locale']).toHaveLength(0);
  });
});
