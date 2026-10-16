import '@testing-library/jest-dom';
import { act, render, renderHook } from '@testing-library/react';
import App, { useSchemeTheme } from '../renderer/App';

describe('App', () => {
  it('should render', () => {
    expect(render(<App />)).toBeTruthy();
  });
});

describe('useSchemeTheme (GitHub #16)', () => {
  let listeners: (() => void)[];
  const scheme = { matches: false };
  beforeEach(() => {
    listeners = [];
    scheme.matches = false;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn((query: string) => ({
        get matches() {
          return query === '(prefers-color-scheme: dark)' && scheme.matches;
        },
        // MUI's useMediaQuery listens with the older addListener.
        addListener: (fn: () => void) => listeners.push(fn),
        removeListener: jest.fn(),
      })),
    });
  });
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('is the light theme when the dark scheme is not in force', () => {
    const { result } = renderHook(() => useSchemeTheme());
    expect(result.current.palette.mode).toBe('light');
    expect(result.current.palette.background.default).toBe('#FFF5EE');
  });

  it('is the dark theme when it is', () => {
    scheme.matches = true;
    const { result } = renderHook(() => useSchemeTheme());
    expect(result.current.palette.mode).toBe('dark');
    expect(result.current.palette.background.default).toBe('#1F1A1C');
  });

  it('follows the scheme when it changes', () => {
    const { result } = renderHook(() => useSchemeTheme());
    scheme.matches = true;
    act(() => listeners.forEach((fn) => fn()));
    expect(result.current.palette.mode).toBe('dark');
  });
});
