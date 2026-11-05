import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ElectronHandler } from 'main/preload';
import FontPicker, {
  familiesOf,
  LIST_FAILED_LOG,
} from '../renderer/poemFont/FontPicker';
import {
  FontStore,
  PoemFontContext,
  usePoemFont,
  usePoemFontState,
} from '../renderer/poemFont/PoemFontContext';
import { APP_FONT_STACK } from '../renderer/poemFont/poemFont';
import { MetaStore } from '../renderer/tracking/markerStore';
import { i18n } from '../shared/i18n';

// View > Font… (#240). Synthetic font names only.

type Listener = Parameters<ElectronHandler['ipcRenderer']['on']>[1];

const installBridge = (fonts: { family: string }[] | Error | 'absent') => {
  const listeners: Record<string, Listener[]> = {};
  const sent: string[] = [];
  const errors: { message: string; meta: unknown }[] = [];
  (window as unknown as { electron: unknown }).electron = {
    ipcRenderer: {
      on: (channel: string, listener: Listener) => {
        listeners[channel] = [...(listeners[channel] ?? []), listener];
        return () => {
          listeners[channel] = listeners[channel].filter((l) => l !== listener);
        };
      },
      sendMessage: (channel: string) => sent.push(channel),
    },
    log: {
      error: (message: string, meta: unknown) => errors.push({ message, meta }),
    },
  };
  const w = window as unknown as { queryLocalFonts?: () => Promise<unknown> };
  if (fonts === 'absent') delete w.queryLocalFonts;
  else
    w.queryLocalFonts = () =>
      fonts instanceof Error ? Promise.reject(fonts) : Promise.resolve(fonts);
  const emit = (channel: string) =>
    act(() => {
      (listeners[channel] ?? []).forEach((l) => l());
    });
  return { sent, errors, emit };
};

const makeStore = (initial: Record<string, unknown>) => {
  const values: Record<string, unknown> = { ...initial };
  const store: FontStore = {
    get: (key) => values[key],
    set: (key, value) => {
      values[key] = value;
    },
  };
  return { store, values };
};

function Harness({ store }: { store: FontStore }) {
  const poemFont = usePoemFontState(store);
  return (
    <PoemFontContext.Provider value={poemFont}>
      <span data-testid="family">{poemFont.family ?? 'none'}</span>
      <FontPicker />
    </PoemFontContext.Provider>
  );
}

const FONTS = [
  { family: 'Zqbeta' },
  { family: 'Zqalpha' },
  { family: 'Zqbeta' },
  { family: ' ' },
  { family: 'Zqgamma' },
];
const optionNames = () =>
  screen.queryAllByRole('option').map((o) => o.textContent);
const option = (name: string) => screen.getByRole('option', { name });
const field = () =>
  screen.getByRole('combobox', { name: i18n._('fontPicker.search') });

afterEach(() => {
  delete (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts;
  document.documentElement.style.removeProperty('--poem-font');
});

it("lists each family once, sorted, after the app's own font", () => {
  expect(familiesOf(FONTS)).toEqual(['Zqalpha', 'Zqbeta', 'Zqgamma']);
});

it('is closed until View > Font… asks, then lists the installed fonts, each in its own face', async () => {
  const bridge = installBridge(FONTS);
  render(<Harness store={makeStore({}).store} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  bridge.emit('choose-font');
  expect(
    screen.getByRole('dialog', { name: i18n._('fontPicker.title') })
  ).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    i18n._('fontPicker.loading')
  );
  await waitFor(() =>
    expect(optionNames()).toEqual([
      i18n._('fontPicker.appFont'),
      'Libre Caslon Text',
      'Zqalpha',
      'Zqbeta',
      'Zqgamma',
    ])
  );
  expect(option('Zqbeta')).toHaveStyle({
    fontFamily: `"Zqbeta", ${APP_FONT_STACK}`,
  });
  expect(option(i18n._('fontPicker.appFont'))).toHaveAttribute(
    'data-current',
    'true'
  );
  expect(field()).toHaveFocus();
});

it('filters as the poet types, and says when nothing matches', async () => {
  const bridge = installBridge(FONTS);
  render(<Harness store={makeStore({}).store} />);
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  fireEvent.change(field(), { target: { value: 'GAM' } });
  expect(optionNames()).toEqual(['Zqgamma']);
  fireEvent.change(field(), { target: { value: 'nothing like it' } });
  expect(optionNames()).toEqual([]);
  expect(screen.getByRole('status')).toHaveTextContent(
    i18n._('fontPicker.noMatch')
  );
});

it('chooses with the arrow keys and Enter: writes meta, keeps the rest, marks it unsaved, saves, and sets --poem-font', async () => {
  const bridge = installBridge(FONTS);
  const { store, values } = makeStore({
    meta: JSON.stringify({ draftMarkers: [{ index: 1 }] }),
    edited: false,
  });
  render(<Harness store={store} />);
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(JSON.parse(String(values.meta))).toEqual({
    draftMarkers: [{ index: 1 }],
    fontFamily: 'Zqbeta',
  });
  expect(values.edited).toBe(true);
  // The last font chosen, which a new poem starts in (GitHub #48).
  expect(values['font-family']).toBe('Zqbeta');
  expect(bridge.sent).toEqual(['save-file']);
  expect(screen.getByTestId('family')).toHaveTextContent('Zqbeta');
  expect(document.documentElement.style.getPropertyValue('--poem-font')).toBe(
    `"Zqbeta", ${APP_FONT_STACK}`
  );
  // It stays open after a choice, so the poet can try another (GitHub #112, editor #417).
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it("chooses with a click, and the app's own font takes the poem's font away", async () => {
  const bridge = installBridge(FONTS);
  const { store, values } = makeStore({
    meta: JSON.stringify({ fontFamily: 'Zqalpha', other: 1 }),
  });
  render(<Harness store={store} />);
  expect(document.documentElement.style.getPropertyValue('--poem-font')).toBe(
    `"Zqalpha", ${APP_FONT_STACK}`
  );
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  expect(option('Zqalpha')).toHaveAttribute('data-current', 'true');
  fireEvent.mouseEnter(option(i18n._('fontPicker.appFont')));
  fireEvent.click(option(i18n._('fontPicker.appFont')));
  expect(JSON.parse(String(values.meta))).toEqual({ other: 1 });
  expect(values['font-family']).toBe('');
  expect(document.documentElement.style.getPropertyValue('--poem-font')).toBe(
    APP_FONT_STACK
  );
});

it('choosing the font the poem already has changes nothing', async () => {
  const bridge = installBridge(FONTS);
  const { store, values } = makeStore({
    meta: JSON.stringify({ fontFamily: 'Zqalpha' }),
    edited: false,
  });
  render(<Harness store={store} />);
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  fireEvent.click(option('Zqalpha'));
  expect(values.edited).toBe(false);
  expect(bridge.sent).toEqual([]);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

// GitHub #112 (editor #417): the poet tries one font after another, and only Escape or the X closes the picker.
it('stays open through several choices, each saved, until Escape; the last one chosen is kept', async () => {
  const bridge = installBridge(FONTS);
  const { store, values } = makeStore({ meta: '' });
  render(<Harness store={store} />);
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  fireEvent.click(option('Zqalpha'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(option('Zqgamma'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(option('Zqgamma')).toHaveAttribute('data-current', 'true');
  expect(bridge.sent).toEqual(['save-file', 'save-file']);
  fireEvent.keyDown(field(), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(JSON.parse(String(values.meta))).toEqual({ fontFamily: 'Zqgamma' });
  expect(screen.getByTestId('family')).toHaveTextContent('Zqgamma');
});

it('a click on a font leaves the focus in the search field, so Escape still closes the picker', async () => {
  const bridge = installBridge(FONTS);
  render(<Harness store={makeStore({ meta: '' }).store} />);
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  const row = option('Zqbeta');
  // fireEvent.mouseDown returns false when the default (moving the focus) was prevented.
  expect(fireEvent.mouseDown(row)).toBe(false);
  fireEvent.click(row);
  expect(document.activeElement).toBe(field());
});

it('Escape closes it without a change; the close button does too', async () => {
  const bridge = installBridge(FONTS);
  const { store, values } = makeStore({ meta: '' });
  render(<Harness store={store} />);
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  fireEvent.keyDown(field(), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  fireEvent.click(
    screen.getByRole('button', { name: i18n._('fontPicker.close') })
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(values.meta).toBe('');
  expect(bridge.sent).toEqual([]);
});

it('a font this computer lacks is shown as not installed, and keeps its place', async () => {
  const bridge = installBridge(FONTS);
  render(
    <Harness
      store={
        makeStore({ meta: JSON.stringify({ fontFamily: 'Zqmissing' }) }).store
      }
    />
  );
  bridge.emit('choose-font');
  const label = i18n._('fontPicker.notInstalled', { family: 'Zqmissing' });
  await waitFor(() =>
    expect(optionNames()).toEqual([
      i18n._('fontPicker.appFont'),
      'Libre Caslon Text',
      label,
      'Zqalpha',
      'Zqbeta',
      'Zqgamma',
    ])
  );
  expect(option(label)).toHaveAttribute('data-current', 'true');
});

it.each([
  ['the API is absent', 'absent' as const],
  ['the listing fails', new Error('denied')],
])(
  'says the fonts could not be listed when %s, and logs no font names',
  async (_why, fonts) => {
    const bridge = installBridge(fonts);
    render(<Harness store={makeStore({}).store} />);
    bridge.emit('choose-font');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n._('fontPicker.unavailable')
    );
    // The fonts that come with the app are still offered (editor #445).
    expect(optionNames()).toEqual([
      i18n._('fontPicker.appFont'),
      'Libre Caslon Text',
    ]);
    expect(bridge.errors).toEqual([
      { message: LIST_FAILED_LOG, meta: { error: 'Error' } },
    ]);
  }
);

// The fonts that come with the app (editor #445; Annelyse, GitHub #73): Libre Caslon Text straight after the
// app's own font, installed or not.
describe('the fonts that come with the app', () => {
  it("lists Libre Caslon Text once, after the app's own font, when it is installed too", async () => {
    const bridge = installBridge([...FONTS, { family: 'Libre Caslon Text' }]);
    render(<Harness store={makeStore({}).store} />);
    bridge.emit('choose-font');
    await waitFor(() => expect(optionNames()).toHaveLength(5));
    expect(optionNames()).toEqual([
      i18n._('fontPicker.appFont'),
      'Libre Caslon Text',
      'Zqalpha',
      'Zqbeta',
      'Zqgamma',
    ]);
    expect(option('Libre Caslon Text')).toHaveStyle({
      fontFamily: `"Libre Caslon Text", ${APP_FONT_STACK}`,
    });
  });

  it('choosing it writes its name into the poem', async () => {
    const bridge = installBridge(FONTS);
    const { store, values } = makeStore({ meta: '' });
    render(<Harness store={store} />);
    bridge.emit('choose-font');
    await waitFor(() => expect(optionNames()).toHaveLength(5));
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(JSON.parse(String(values.meta))).toEqual({
      fontFamily: 'Libre Caslon Text',
    });
    expect(bridge.sent).toEqual(['save-file']);
  });

  it('a poem in it is not shown as missing on a computer without it installed', async () => {
    const bridge = installBridge(FONTS);
    render(
      <Harness
        store={
          makeStore({
            meta: JSON.stringify({ fontFamily: 'Libre Caslon Text' }),
          }).store
        }
      />
    );
    bridge.emit('choose-font');
    await waitFor(() => expect(optionNames()).toHaveLength(5));
    expect(optionNames()).not.toContain(
      i18n._('fontPicker.notInstalled', { family: 'Libre Caslon Text' })
    );
    expect(option('Libre Caslon Text')).toHaveAttribute('data-current', 'true');
  });

  it('the search finds it, and leaves it out when it does not match', async () => {
    const bridge = installBridge(FONTS);
    render(<Harness store={makeStore({}).store} />);
    bridge.emit('choose-font');
    await waitFor(() => expect(optionNames()).toHaveLength(5));
    fireEvent.change(field(), { target: { value: 'caslon' } });
    expect(optionNames()).toEqual(['Libre Caslon Text']);
    fireEvent.change(field(), { target: { value: 'zqa' } });
    expect(optionNames()).toEqual(['Zqalpha']);
  });
});

it("keeps the font and says so when the poem's settings cannot be read", async () => {
  const bridge = installBridge(FONTS);
  const { store, values } = makeStore({ meta: 'not json' });
  render(<Harness store={store} />);
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  fireEvent.click(option('Zqgamma'));
  expect(screen.getByRole('alert')).toHaveTextContent(
    i18n._('fontPicker.metaUnreadable')
  );
  expect(values.meta).toBe('not json');
  expect(values['font-family']).toBeUndefined();
  expect(bridge.sent).toEqual([]);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('a later choice that saves takes the problem message away', async () => {
  const bridge = installBridge(FONTS);
  const { store, values } = makeStore({ meta: 'not json' });
  render(<Harness store={store} />);
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  fireEvent.click(option('Zqgamma'));
  expect(screen.getByRole('alert')).toHaveTextContent(
    i18n._('fontPicker.metaUnreadable')
  );
  values.meta = '';
  fireEvent.click(option('Zqbeta'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(bridge.sent).toEqual(['save-file']);
});

it('follows the poem that is opened', () => {
  const bridge = installBridge(FONTS);
  const { store, values } = makeStore({
    meta: JSON.stringify({ fontFamily: 'Zqalpha' }),
  });
  render(<Harness store={store} />);
  expect(screen.getByTestId('family')).toHaveTextContent('Zqalpha');
  values.meta = '';
  bridge.emit('open-file');
  expect(screen.getByTestId('family')).toHaveTextContent('none');
});

it('works with no preload: no font, and a choice changes nothing', () => {
  (window as unknown as { electron?: unknown }).electron = undefined;
  const { result } = renderHook(() => usePoemFontState(undefined));
  expect(result.current.family).toBeNull();
  expect(result.current.choose('Zqalpha')).toBe('meta-unreadable');
});

it('arrow keys do nothing when no font matches', async () => {
  const bridge = installBridge(FONTS);
  render(<Harness store={makeStore({}).store} />);
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  fireEvent.change(field(), { target: { value: 'nothing like it' } });
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  fireEvent.keyDown(field(), { key: 'Enter' });
  fireEvent.keyDown(field(), { key: 'a' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(field()).not.toHaveAttribute('aria-activedescendant');
});

it("outside a provider, the font is the app's and a choice changes nothing", () => {
  const { result } = renderHook(() => usePoemFont());
  expect(result.current.family).toBeNull();
  expect(result.current.choose('Zqalpha')).toBe('meta-unreadable');
});

it('logs the kind of a failure that is not an Error', async () => {
  const bridge = installBridge(FONTS);
  (
    window as unknown as { queryLocalFonts: () => Promise<unknown> }
  ).queryLocalFonts = () =>
    // eslint-disable-next-line prefer-promise-reject-errors -- the case under test is a rejection that is not an Error
    Promise.reject('refused');
  render(<Harness store={makeStore({}).store} />);
  bridge.emit('choose-font');
  await screen.findByRole('alert');
  expect(bridge.errors).toEqual([
    { message: LIST_FAILED_LOG, meta: { error: 'string' } },
  ]);
});

it('closing gives the poem back the keyboard', async () => {
  const bridge = installBridge(FONTS);
  const poem = document.createElement('div');
  poem.className = 'ProseMirror';
  poem.tabIndex = -1;
  document.body.appendChild(poem);
  render(<Harness store={makeStore({}).store} />);
  bridge.emit('choose-font');
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  fireEvent.keyDown(field(), { key: 'Escape' });
  expect(poem).toHaveFocus();
  poem.remove();
});

it('reads the preload store by default', () => {
  installBridge(FONTS);
  const { store } = makeStore({
    meta: JSON.stringify({ fontFamily: 'Zqalpha' }),
  });
  (window as unknown as { electron: { store: MetaStore } }).electron.store =
    store;
  function Default() {
    return (
      <span data-testid="family">{usePoemFontState().family ?? 'none'}</span>
    );
  }
  render(<Default />);
  expect(screen.getByTestId('family')).toHaveTextContent('Zqalpha');
});
