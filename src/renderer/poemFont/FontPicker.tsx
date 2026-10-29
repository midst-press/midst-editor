import CloseIcon from '@mui/icons-material/Close';
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { i18n } from '../../shared/i18n';
import { poemFontStack } from './poemFont';
import { ChooseResult, usePoemFont } from './PoemFontContext';
import './FontPicker.css';

// View > Font… (#240; Annelyse, GitHub #73): any font installed on the poet's computer, one font for the
// whole poem. Each font is listed in its own face, which a native menu cannot draw, so the choice is
// made here, in the window. The first entry is the app's own font: a poem with no font of its own.

export const FONT_PICKER_CLASS = 'font-picker';
export const LIST_FAILED_LOG = 'listing the installed fonts failed';

// Chromium's Local Font Access API. It needs a secure context, which the app's file: page is.
interface LocalFont {
  family: string;
}
type QueryLocalFonts = () => Promise<LocalFont[]>;
const queryLocalFonts = (): QueryLocalFonts | undefined =>
  (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;

// Each family once, in the order of the poet's language.
export const familiesOf = (fonts: LocalFont[]): string[] =>
  Array.from(
    new Set(fonts.map((font) => font.family).filter((f) => f.trim() !== ''))
  ).sort((a, b) => a.localeCompare(b));

type Listing =
  | { state: 'loading' }
  | { state: 'ready'; families: string[] }
  | { state: 'unavailable' };

// One row of the list: null is the app's own font.
interface Row {
  family: string | null;
  label: string;
}

export default function FontPicker() {
  const { family: current, choose } = usePoemFont();
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(0);
  const [listing, setListing] = useState<Listing>({ state: 'loading' });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [problem, setProblem] = useState<Exclude<ChooseResult, 'saved'> | null>(
    null
  );
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      window.electron.ipcRenderer.on('choose-font', () => {
        // Each opening starts afresh: no search, no old problem, and the fonts listed again below.
        setQuery('');
        setProblem(null);
        setActive(0);
        setListing({ state: 'loading' });
        setOpen(true);
        setAsked((n) => n + 1);
      }),
    []
  );

  // Fonts are listed each time the picker opens, so one installed meanwhile is offered.
  useEffect(() => {
    if (!asked) return undefined;
    let live = true;
    const list = queryLocalFonts();
    (list
      ? list()
      : Promise.reject(new Error('queryLocalFonts is not available'))
    )
      .then((fonts) => {
        if (live) {
          setListing({ state: 'ready', families: familiesOf(fonts) });
          setActive(0);
        }
        return undefined;
      })
      .catch((error) => {
        window.electron.log.error(LIST_FAILED_LOG, {
          error: error instanceof Error ? error.name : typeof error,
        });
        if (live) setListing({ state: 'unavailable' });
      });
    input.current?.focus();
    return () => {
      live = false;
    };
  }, [asked]);

  const rows = useMemo((): Row[] => {
    const installed = listing.state === 'ready' ? listing.families : [];
    const wanted = query.trim().toLocaleLowerCase();
    const matches = (name: string) =>
      !wanted || name.toLocaleLowerCase().includes(wanted);
    const list: Row[] = [];
    if (matches(i18n._('fontPicker.appFont')))
      list.push({ family: null, label: i18n._('fontPicker.appFont') });
    // The poem's font when this computer does not have it: shown so the poet can see what the poem asks
    // for. Choosing it again keeps it.
    if (
      current !== null &&
      listing.state === 'ready' &&
      !installed.includes(current) &&
      matches(current)
    )
      list.push({
        family: current,
        label: i18n._('fontPicker.notInstalled', { family: current }),
      });
    installed
      .filter(matches)
      .forEach((family) => list.push({ family, label: family }));
    return list;
  }, [listing, query, current]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    document.querySelector<HTMLElement>('.ProseMirror')?.focus();
  };

  const pick = (row: Row | undefined) => {
    if (!row) return;
    if (row.family === current) {
      close();
      return;
    }
    const result = choose(row.family);
    if (result === 'saved') close();
    else setProblem(result);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      const by = event.key === 'ArrowDown' ? 1 : -1;
      setActive((n) => (n + by + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(rows[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  let status = '';
  if (listing.state === 'loading') status = i18n._('fontPicker.loading');
  else if (listing.state === 'ready' && rows.length === 0)
    status = i18n._('fontPicker.noMatch');

  return (
    <div
      className={FONT_PICKER_CLASS}
      role="dialog"
      aria-label={i18n._('fontPicker.title')}
    >
      <div className="font-picker-head">
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="font-picker-list"
          aria-activedescendant={
            rows.length ? `font-picker-row-${active}` : undefined
          }
          aria-label={i18n._('fontPicker.search')}
          placeholder={i18n._('fontPicker.search')}
          value={query}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={i18n._('fontPicker.close')}
          onClick={close}
        >
          <CloseIcon fontSize="small" />
        </button>
      </div>
      <span className="font-picker-status" role="status">
        {status}
      </span>
      {listing.state === 'unavailable' && (
        <span className="font-picker-problem" role="alert">
          {i18n._('fontPicker.unavailable')}
        </span>
      )}
      {problem && (
        <span className="font-picker-problem" role="alert">
          {i18n._('fontPicker.metaUnreadable')}
        </span>
      )}
      <ul
        id="font-picker-list"
        role="listbox"
        aria-label={i18n._('fontPicker.title')}
      >
        {rows.map((row, index) => (
          // Keyboard choice is through the field above (aria-activedescendant); a click chooses too.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <li
            key={row.family === null ? '' : `${index}:${row.family}`}
            id={`font-picker-row-${index}`}
            role="option"
            aria-selected={index === active}
            data-current={row.family === current ? 'true' : undefined}
            style={{ fontFamily: poemFontStack(row.family) }}
            onMouseEnter={() => setActive(index)}
            onClick={() => pick(row)}
          >
            {row.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
