import '@testing-library/jest-dom';
import { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from '../renderer/App';
import { RETURN_TO, TextContext } from '../renderer/context';

// #125: the window title is set in one place, from App's file name and the route. These drive App as the
// main process does, through its messages, and read every title the renderer set.

// The editor's own behaviour is tested elsewhere. Here it stands in for the route: it can change the poem
// (which re-renders App) and go back to the opening screen, as a cancelled save does.
jest.mock('../renderer/components/Editor', () => ({
  __esModule: true,
  default: function EditorStub() {
    const { setText } = useContext(TextContext);
    const navigate = useNavigate();
    return (
      <>
        <p>EDITOR STUB</p>
        <button type="button" onClick={() => setText('<p>zqxv</p>')}>
          type
        </button>
        <button type="button" onClick={() => navigate('/')}>
          leave
        </button>
      </>
    );
  },
}));

/* eslint-disable-next-line no-unused-vars -- a type's parameter name, not a variable */
type Handler = (...args: unknown[]) => void;

let handlers: Map<string, Handler[]>;
let titles: string[];
let stored: Record<string, string>;

const emit = (channel: string, ...args: unknown[]) =>
  act(() => {
    (handlers.get(channel) ?? []).forEach((h) => h(...args));
  });

beforeEach(() => {
  handlers = new Map();
  titles = [];
  stored = {};
  window.sessionStorage.clear();
  (window as unknown as { electron: unknown }).electron = {
    store: {
      get: (k: string) => stored[k],
      set: (k: string, v: string) => {
        stored[k] = v;
      },
    },
    ipcRenderer: {
      on: (channel: string, h: Handler) => {
        handlers.set(channel, [...(handlers.get(channel) ?? []), h]);
        return () =>
          handlers.set(
            channel,
            (handlers.get(channel) ?? []).filter((x) => x !== h)
          );
      },
      sendMessage: jest.fn(),
    },
    titlebar: { updateTitle: (t: string) => titles.push(t) },
  };
});

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron;
});

const last = () => titles[titles.length - 1];

describe('the window title (#125)', () => {
  it('is empty on the opening screen at launch, even with a file name stored from before', () => {
    stored.baseFilename = 'zq.midst';
    render(<App />);
    expect(screen.getByText('New File...')).toBeInTheDocument();
    expect(titles).toEqual(['']);
  });

  it('is the opened file name once a file is opened from the opening screen', () => {
    render(<App />);
    emit('open-file', '<p>xv</p>', [], 'xv.midst');
    expect(screen.getByText('EDITOR STUB')).toBeInTheDocument();
    expect(last()).toBe('xv.midst');
  });

  it('is Untitled for a new poem with no name yet', () => {
    render(<App />);
    emit('open-file', '', [], '');
    expect(screen.getByText('EDITOR STUB')).toBeInTheDocument();
    expect(last()).toBe('Untitled');
  });

  it('follows the name main reports after a save', () => {
    render(<App />);
    emit('open-file', '', [], '');
    emit('set-filename', 'qj.midst');
    expect(last()).toBe('qj.midst');
  });

  it('is empty again back on the opening screen, and the name again when a file opens', () => {
    render(<App />);
    emit('open-file', '<p>xv</p>', [], 'xv.midst');
    fireEvent.click(screen.getByText('leave'));
    expect(screen.getByText('New File...')).toBeInTheDocument();
    expect(last()).toBe('');
    emit('open-file', '<p>zq</p>', [], 'zq.midst');
    expect(last()).toBe('zq.midst');
  });

  it('after a reload into the editor, is the stored name, or Untitled with none', () => {
    stored.baseFilename = 'zq.midst';
    window.sessionStorage.setItem(RETURN_TO, '/editor');
    const { unmount } = render(<App />);
    expect(titles).toEqual(['zq.midst']);
    unmount();

    titles = [];
    stored.baseFilename = '';
    window.sessionStorage.setItem(RETURN_TO, '/editor');
    render(<App />);
    expect(titles).toEqual(['Untitled']);
  });

  it('is set once per change, not on every render', () => {
    render(<App />);
    emit('open-file', '<p>xv</p>', [], 'xv.midst');
    const count = titles.length;
    fireEvent.click(screen.getByText('type'));
    fireEvent.click(screen.getByText('type'));
    emit('set-filename', 'xv.midst');
    expect(titles).toHaveLength(count);
  });
});
