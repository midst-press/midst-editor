import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useContext, useMemo, useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Replay from '../renderer/components/Replay';
import RestartIcon from '../renderer/components/Replay/restartIcon';
import {
  FAILED_LOG,
  MISMATCH_LOG,
  NO_DIFFERENCE_LOG,
  NO_HISTORY,
  NOTHING_TO_CHANGE,
  SHOWN_MESSAGE,
  UNREPLAYABLE,
} from '../renderer/components/Replay/RestartFromButton';
import { HistoryContext, TextContext } from '../renderer/context';
import { RestartFromError } from '../renderer/tracking/restartFrom';
import {
  ChangeObj,
  compareStrings,
  reconstruct,
} from '../renderer/tracking/utils';

// jest.mock is hoisted above the imports; `mockRestartFrom` is read only when a test calls it.
const mockRestartFrom = jest.fn();
const mockWouldChange = jest.fn();
jest.mock('../renderer/tracking/restartFrom', () => ({
  ...jest.requireActual('../renderer/tracking/restartFrom'),
  restartFrom: (...args: unknown[]) => mockRestartFrom(...args),
  wouldChange: (...args: unknown[]) => mockWouldChange(...args),
}));

// Synthetic text only.
const TEXTS = [
  '<p>zq</p>',
  '<p>zq qv</p>',
  '<p>zq qv zq</p>',
  '<p>zq qv zq qv</p>',
];

const historyOf = (texts: string[]): ChangeObj[] =>
  texts.map((text, i) =>
    compareStrings(i === 0 ? '' : texts[i - 1], text, text.length, new Date(i))
  );

type Event = [string, ...unknown[]];

let events: Event[];
let logError: jest.Mock;
let finalState: { text: string; history: ChangeObj[] } | null;

const installBridge = () => {
  logError = jest.fn();
  (window as unknown as { electron: unknown }).electron = {
    versions: { isMac: true },
    store: {
      get: () => 'false',
      set: (key: string, value: unknown) =>
        events.push(['store.set', key, value]),
    },
    ipcRenderer: {
      sendMessage: jest.fn(),
      on: () => () => {},
      once: jest.fn(),
    },
    titlebar: { updateTitle: jest.fn() },
    log: {
      error: logError,
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  };
};

const rect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};
beforeAll(() => {
  [Element.prototype, Range.prototype].forEach((proto) => {
    Object.defineProperty(proto, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect,
    });
    Object.defineProperty(proto, 'getClientRects', {
      configurable: true,
      value: () => [],
    });
  });
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => {},
  });
});

beforeEach(() => {
  events = [];
  finalState = null;
  mockWouldChange.mockReset();
  mockWouldChange.mockImplementation(
    jest.requireActual('../renderer/tracking/restartFrom').wouldChange
  );
  mockRestartFrom.mockReset();
  mockRestartFrom.mockImplementation(
    jest.requireActual('../renderer/tracking/restartFrom').restartFrom
  );
  installBridge();
});

// Stands in for the editor: records the store it finds on arrival.
function Arrival() {
  const { text } = useContext(TextContext);
  const { poemHistory } = useContext(HistoryContext);
  events.push(['editor-arrived', text, poemHistory.length]);
  finalState = { text, history: poemHistory };
  return <div>EDITOR PAGE</div>;
}

function Harness({
  history,
  initialText,
}: {
  history: ChangeObj[];
  initialText: string;
}) {
  const [text, setTextState] = useState(initialText);
  const [poemHistory, setHistoryState] = useState(history);
  const textValue = useMemo(
    () => ({
      text,
      setText: (t: string) => {
        events.push(['setText', t]);
        setTextState(t);
      },
    }),
    [text]
  );
  const historyValue = useMemo(
    () => ({
      poemHistory,
      setPoemHistory: (h: ChangeObj[]) => {
        events.push(['setPoemHistory', h.length]);
        setHistoryState(h);
      },
    }),
    [poemHistory]
  );
  return (
    <MemoryRouter initialEntries={['/replay']}>
      <TextContext.Provider value={textValue}>
        <HistoryContext.Provider value={historyValue}>
          <Routes>
            <Route path="/replay" element={<Replay />} />
            <Route path="/editor" element={<Arrival />} />
          </Routes>
        </HistoryContext.Provider>
      </TextContext.Provider>
    </MemoryRouter>
  );
}

const mount = (history = historyOf(TEXTS), text = TEXTS[TEXTS.length - 1]) =>
  render(<Harness history={history} initialText={text} />);
const slider = () => screen.getByRole('slider', { hidden: true });
const seek = (v: number) =>
  fireEvent.change(slider(), { target: { value: String(v) } });
const restartButton = () =>
  screen.getByRole('button', { name: 'Restart from here' });

describe('Restart from here', () => {
  it('is disabled at the last frame, with its reason', () => {
    mount();
    expect(restartButton()).toBeDisabled();
    const reasonId = restartButton().getAttribute('aria-describedby') as string;
    expect(document.getElementById(reasonId)).toHaveTextContent(
      NOTHING_TO_CHANGE
    );
  });

  it('is enabled at an earlier frame, with no reason', () => {
    mount();
    seek(1);
    expect(restartButton()).toBeEnabled();
    expect(restartButton()).not.toHaveAttribute('aria-describedby');
  });

  it('is disabled with its own reason when there is no history', () => {
    mount([], '');
    expect(restartButton()).toBeDisabled();
    const reasonId = restartButton().getAttribute('aria-describedby') as string;
    expect(document.getElementById(reasonId)).toHaveTextContent(NO_HISTORY);
    expect(logError).not.toHaveBeenCalled();
  });

  it('is disabled with a reason, and logs, when the frame cannot be checked', () => {
    const message = 'the frame to restart from is not in the history';
    mockWouldChange.mockImplementation(() => {
      throw new RestartFromError(message);
    });
    mount();
    expect(restartButton()).toBeDisabled();
    const reasonId = restartButton().getAttribute('aria-describedby') as string;
    expect(document.getElementById(reasonId)).toHaveTextContent(UNREPLAYABLE);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toBe(message);
    expect(JSON.stringify(logError.mock.calls)).not.toContain('zq');
  });

  it('logs a fixed message when checking the frame throws a non-Error', () => {
    mockWouldChange.mockImplementation(() => {
      const thrown: unknown = 'zq qv';
      throw thrown;
    });
    mount();
    expect(restartButton()).toBeDisabled();
    expect(logError.mock.calls[0][0]).toBe(FAILED_LOG);
    expect(logError.mock.calls[0][1]).toMatchObject({ name: 'string' });
  });

  it('logs a fixed message when checking the frame throws something else', () => {
    mockWouldChange.mockImplementation(() => {
      throw new TypeError('bad zq qv');
    });
    mount();
    expect(restartButton()).toBeDisabled();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toBe(FAILED_LOG);
    expect(JSON.stringify(logError.mock.calls)).not.toContain('zq');
  });

  it('appends exactly one change, sets the store, and replays to the chosen text', () => {
    const old = historyOf(TEXTS);
    mount(old);
    seek(1);
    fireEvent.click(restartButton());
    expect(finalState).not.toBeNull();
    const state = finalState as unknown as {
      text: string;
      history: ChangeObj[];
    };
    expect(state.history).toHaveLength(old.length + 1);
    expect(state.history.slice(0, old.length)).toEqual(old);
    expect(state.text).toBe(TEXTS[1]);
    expect(reconstruct('', state.history, state.history.length - 1)).toBe(
      TEXTS[1]
    );
    expect(screen.getByText(/EDITOR PAGE/)).toBeInTheDocument();
    expect(logError).not.toHaveBeenCalled();
  });

  it('updates the store and marks the poem edited before navigating', () => {
    mount();
    seek(0);
    fireEvent.click(restartButton());
    const names = events.map((e) =>
      e[0] === 'store.set' ? `store.set:${e[1]}` : e[0]
    );
    const arrival = names.indexOf('editor-arrived');
    expect(arrival).toBeGreaterThan(-1);
    ['setPoemHistory', 'setText', 'store.set:edited'].forEach((n) => {
      const at = names.indexOf(n);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(arrival);
    });
    expect(events).toContainEqual(['store.set', 'edited', 'true']);
    expect(events).toContainEqual([
      'editor-arrived',
      TEXTS[0],
      TEXTS.length + 1,
    ]);
  });

  it('refuses, logs, alerts and changes nothing when the history does not replay to the current text', () => {
    mount(historyOf(TEXTS), '<p>other</p>');
    seek(1);
    fireEvent.click(restartButton());
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toBe(MISMATCH_LOG);
    expect(screen.getByRole('alert')).toHaveTextContent(SHOWN_MESSAGE);
    expect(
      events.filter((e) => e[0] !== 'store.set' || e[1] === 'edited')
    ).toEqual([]);
    expect(screen.queryByText(/EDITOR PAGE/)).toBeNull();
  });

  it('refuses and logs when the texts differ but the documents do not', () => {
    // Same document, different markup: no position to restart at.
    mount(historyOf(['<P>zq</P>', '<p>zq qv</p>', '<p>zq</p>']), '<p>zq</p>');
    seek(0);
    fireEvent.click(restartButton());
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toBe(NO_DIFFERENCE_LOG);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(events).toEqual([]);
  });

  it('logs the fixed message and alerts when restartFrom throws RestartFromError', () => {
    const message = 'the new history does not replay to the chosen frame';
    mockRestartFrom.mockImplementation(() => {
      throw new RestartFromError(message);
    });
    mount();
    seek(1);
    fireEvent.click(restartButton());
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toBe(message);
    expect(logError.mock.calls[0][1]).toMatchObject({
      name: 'RestartFromError',
    });
    expect(screen.getByRole('alert')).toHaveTextContent(SHOWN_MESSAGE);
    expect(events).toEqual([]);
  });

  it('logs, alerts and never quotes the poem for any other error', () => {
    mockRestartFrom.mockImplementation(() => {
      throw new TypeError('bad zq qv');
    });
    mount();
    seek(1);
    fireEvent.click(restartButton());
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toBe(FAILED_LOG);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(events).toEqual([]);
  });

  it('logs a thrown value that is not an Error', () => {
    mockRestartFrom.mockImplementation(() => {
      const thrown: unknown = 'zq qv';
      throw thrown;
    });
    mount();
    seek(1);
    fireEvent.click(restartButton());
    expect(logError.mock.calls[0][0]).toBe(FAILED_LOG);
    expect(logError.mock.calls[0][1]).toMatchObject({ name: 'string' });
  });

  it('passes no poem text in the log meta', () => {
    mockRestartFrom.mockImplementation(() => {
      throw new RestartFromError(
        'the new history does not replay to the chosen frame'
      );
    });
    mount();
    seek(1);
    fireEvent.click(restartButton());
    const logged = JSON.stringify(logError.mock.calls);
    expect(logged).not.toContain('zq');
    expect(logged).not.toContain('qv');
  });

  it('clears an earlier alert when the next attempt starts', () => {
    mockRestartFrom.mockImplementationOnce(() => {
      throw new RestartFromError(
        'the new history does not replay to the chosen frame'
      );
    });
    mount();
    seek(1);
    fireEvent.click(restartButton());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(restartButton()); // the one-time failure is spent: the real restartFrom runs
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pauses playback when pressed', () => {
    // A refused restart keeps the poet on the replay, where the pause can be seen.
    mount(historyOf(TEXTS), '<p>other</p>');
    seek(1);
    fireEvent.click(
      screen.getByTestId('PlayArrowIcon').closest('button') as HTMLElement
    );
    expect(screen.queryByTestId('PauseIcon')).not.toBeNull();
    fireEvent.click(restartButton());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('PauseIcon')).toBeNull();
  });

  it('uses the icon exported by restartIcon', () => {
    mount();
    seek(1);
    const { container } = render(<RestartIcon />);
    const testId = container.querySelector('svg')?.getAttribute('data-testid');
    expect(testId).toBe('UTurnLeftIcon');
    expect(
      restartButton().querySelector(`[data-testid="${testId}"]`)
    ).not.toBeNull();
  });
});
