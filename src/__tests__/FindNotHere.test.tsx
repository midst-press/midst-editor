import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ElectronHandler } from 'main/preload';
import LandingDialog from '../renderer/components/LandingDialog';
import { HistoryContext, TextContext } from '../renderer/context';
import FindNotHere, {
  findBeforeOpen,
  findInReplay,
  SHOWN_FOR,
} from '../renderer/search/FindNotHere';

type Listener = Parameters<ElectronHandler['ipcRenderer']['on']>[1];

const installBridge = () => {
  const listeners: Record<string, Listener[]> = {};
  (window as unknown as { electron: unknown }).electron = {
    versions: { isMac: false },
    store: { get: () => undefined, set: () => undefined },
    titlebar: { updateTitle: () => undefined },
    ipcRenderer: {
      sendMessage: () => undefined,
      on: (channel: string, listener: Listener) => {
        listeners[channel] = [...(listeners[channel] ?? []), listener];
        return () => {
          listeners[channel] = listeners[channel].filter((l) => l !== listener);
        };
      },
    },
  };
  return {
    listening: () => (listeners['find-in-poem'] ?? []).length,
    find: () =>
      act(() => {
        (listeners['find-in-poem'] ?? []).forEach((l) => l());
      }),
  };
};

const wait = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

let bridge: ReturnType<typeof installBridge>;
beforeEach(() => {
  jest.useFakeTimers();
  bridge = installBridge();
});
afterEach(() => jest.useRealTimers());

describe('FindNotHere', () => {
  it('FN-1 says nothing until Edit > Find, then gives its message', () => {
    render(<FindNotHere message="zq" />);
    expect(screen.queryByRole('alert')).toBeNull();
    bridge.find();
    expect(screen.getByRole('alert')).toHaveTextContent('zq');
  });

  it('FN-2 the message goes after its time, not before', () => {
    render(<FindNotHere message="zq" />);
    bridge.find();
    wait(SHOWN_FOR - 1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    wait(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('FN-3 asking again starts the time again', () => {
    render(<FindNotHere message="zq" />);
    bridge.find();
    wait(SHOWN_FOR - 1);
    bridge.find();
    wait(SHOWN_FOR - 1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    wait(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('FN-4 stops listening when it goes away', () => {
    const { unmount } = render(<FindNotHere message="zq" />);
    expect(bridge.listening()).toBe(1);
    unmount();
    expect(bridge.listening()).toBe(0);
  });

  it('FN-5 the Replay message names the Mac or the other keys', () => {
    expect(findInReplay(true)).toContain('Command+T');
    expect(findInReplay(false)).toContain('Ctrl+T');
    expect(findInReplay(false)).not.toContain('Command');
  });
});

describe('the opening screen', () => {
  it('FN-6 answers Edit > Find: there is no poem to search yet', () => {
    render(
      <MemoryRouter>
        <TextContext.Provider value={{ text: '', setText: jest.fn() }}>
          <HistoryContext.Provider
            value={{ poemHistory: [], setPoemHistory: jest.fn() }}
          >
            <LandingDialog />
          </HistoryContext.Provider>
        </TextContext.Provider>
      </MemoryRouter>
    );
    bridge.find();
    expect(screen.getByRole('alert')).toHaveTextContent(findBeforeOpen());
  });
});
