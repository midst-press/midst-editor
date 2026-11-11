/* eslint-disable lingui/no-unlocalized-strings -- an audition tool for Annelyse (GitHub #119), in English only and
   never in a release; see README.md in this folder */
import CloseIcon from '@mui/icons-material/Close';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import themeObj, { darkThemeObj } from '../theme';
import KEEPS_FOCUS from '../keepsFocus';
import {
  AUDITION_COLOURS,
  AuditionColour,
  applyImported,
  Choices,
  Scheme,
  SCHEMES,
  cssText,
  hexList,
  loadChoices,
  noChoices,
  parseColour,
  parseHexList,
  saveChoices,
  themeWith,
  toHex,
  withRgb,
} from './colours';
import { Defaults, defaultsFrom } from './defaults';
import {
  LogoState,
  MAX_OUTLINE,
  NO_LOGO_CHANGE,
  drawLogo,
  loadLogo,
  logoCss,
  readLogo,
  saveLogo,
} from './logo';
import './ColourAudition.css';

// View > Colours… (GitHub #119): Annelyse auditions the app's colours, light and dark separately, and sends us
// the hex codes she settles on. Built only when MIDST_COLOUR_AUDITION is 'true'; see README.md here.

export const STYLE_ID = 'midst-colour-audition';
export const PANEL_CLASS = 'colour-audition';

// Chromium's EyeDropper: a colour from anywhere on the screen.
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const eyeDropper = (): EyeDropperCtor | undefined =>
  (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const SCHEME_NAMES: Record<Scheme, string> = { light: 'Light', dark: 'Dark' };

/* eslint-disable no-unused-vars -- parameters named in function types */
interface RowProps {
  colour: AuditionColour;
  value: string;
  chosen: boolean;
  onChoose: (value: string) => void;
  onRevert: () => void;
}

function ColourRow({ colour, value, chosen, onChoose, onRevert }: RowProps) {
  const rgba = parseColour(value);
  const hex = rgba ? toHex(rgba) : value;
  // What is being typed, until it is committed; null shows the colour's own hex code.
  const [typed, setTyped] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  const commit = () => {
    if (typed === null) return;
    const parsed = parseColour(typed);
    if (!parsed) {
      setBad(true);
      return;
    }
    setTyped(null);
    if (toHex(parsed) !== hex) onChoose(toHex(parsed));
  };
  const pick = async () => {
    const Dropper = eyeDropper();
    if (!Dropper) return;
    try {
      const { sRGBHex } = await new Dropper().open();
      const next = withRgb(sRGBHex, value);
      if (next) onChoose(next);
    } catch {
      // Escape, or a click elsewhere: nothing chosen.
    }
  };
  const id = `colour-audition-${colour.id}`;
  return (
    <div className="colour-audition-row" data-colour={colour.id}>
      <label htmlFor={id} className="colour-audition-label">
        {colour.label}
        {chosen ? ' •' : ''}
      </label>
      <input
        type="color"
        aria-label={`${colour.label}, colour`}
        value={rgba ? toHex({ ...rgba, a: 1 }) : '#000000'}
        disabled={!rgba}
        onChange={(e) => {
          const next = withRgb(e.target.value, value);
          if (next) onChoose(next);
        }}
      />
      <input
        id={id}
        className={`colour-audition-hex${bad ? ' colour-audition-bad' : ''}`}
        aria-label={`${colour.label}, hex code`}
        aria-invalid={bad}
        spellCheck={false}
        value={typed ?? hex}
        onChange={(e) => {
          setTyped(e.target.value);
          setBad(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {eyeDropper() && (
        <button
          type="button"
          onClick={pick}
          aria-label={`${colour.label}, pick from the screen`}
        >
          Pick
        </button>
      )}
      <button
        type="button"
        onClick={onRevert}
        disabled={!chosen}
        aria-label={`${colour.label}, revert`}
      >
        Revert
      </button>
    </div>
  );
}

interface PanelProps {
  inForce: Scheme;
  choices: Choices;
  defaults: Defaults;
  onChange: (choices: Choices) => void;
  onClose: () => void;
  logo: LogoState;
  onLogoChange: (logo: LogoState) => void;
}
/* eslint-enable no-unused-vars */

export function ColourPanel({
  inForce,
  choices,
  defaults,
  onChange,
  onClose,
  logo,
  onLogoChange,
}: PanelProps) {
  const [scheme, setScheme] = useState<Scheme>(inForce);
  // Top right by default, over the toolbar's end; the poet can move it to the left to see what is under it.
  const [left, setLeft] = useState(false);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const value = (c: AuditionColour) =>
    choices[scheme][c.id] ?? defaults[scheme][c.id];
  const set = (id: string, next: string | undefined) => {
    const forScheme = { ...choices[scheme] };
    if (next === undefined) delete forScheme[id];
    else forScheme[id] = next;
    onChange({ ...choices, [scheme]: forScheme });
  };
  // Saving a set to a file and reading one back (GitHub #119): both schemes, with row ids, through main's dialogs.
  const [report, setReport] = useState<string[] | null>(null);
  const files = window.electron?.colourFiles;
  const words = { filterName: 'Text', defaultName: 'Midst colours.txt' };
  // What main's refusal codes mean, in words.
  const why = (
    result: { failure?: string; error?: string },
    fallback: string
  ) => {
    switch (result.failure) {
      case 'poem':
        return 'A colour set is never a .midst file, so no poem was touched.';
      case 'tooLarge':
        return 'That file is too large to be a colour set.';
      case 'unwritable':
        return `Could not save: ${result.error ?? 'unknown error'}`;
      case 'unreadable':
        return `Could not read: ${result.error ?? 'unknown error'}`;
      default:
        return fallback;
    }
  };
  const exportSet = () => {
    if (!files) return;
    const text = SCHEMES.map(
      (s) =>
        `Midst colours, ${SCHEME_NAMES[s]}\n${hexList(s, (c) => choices[s][c.id] ?? defaults[s][c.id], true)}`
    ).join('\n\n');
    const result = files.exportSet(text, words);
    if (result.ok) setReport([`Saved both schemes to ${result.path}.`]);
    else if (result.failure !== 'cancelled')
      setReport([why(result, 'Could not save.')]);
  };
  const importSet = () => {
    if (!files) return;
    const result = files.importSet(words);
    if (!result.ok) {
      if (result.failure !== 'cancelled')
        setReport([why(result, 'Could not read.')]);
      return;
    }
    const imported = parseHexList(result.text ?? '');
    onChange(applyImported(choices, defaults, imported));
    const read = SCHEMES.filter((s) => imported.colours[s]);
    if (read.length > 0) setScheme(read[0]);
    setReport([
      ...read.map(
        (s) =>
          `Read ${Object.keys(imported.colours[s] ?? {}).length} colours into ${SCHEME_NAMES[s]}.`
      ),
      ...imported.problems,
    ]);
  };
  // A replacement for the squiggly M, from an .svg file (GitHub #119).
  const loadLogoFile = () => {
    if (!files) return;
    const result = files.readLogo({
      filterName: 'SVG drawing',
      defaultName: 'Midst logo.svg',
    });
    if (!result.ok) {
      if (result.failure === 'tooLarge')
        setReport(['That file is too large to be a logo.']);
      else if (result.failure === 'poem')
        setReport(['That is a poem, not a logo, so it was not read.']);
      else if (result.failure !== 'cancelled')
        setReport([why(result, 'Could not read.')]);
      return;
    }
    const read = readLogo(result.text ?? '');
    if (read.logo) onLogoChange({ ...logo, custom: read.logo });
    setReport([
      ...(read.logo
        ? [
            `Drew the logo from ${result.path}, ${read.logo.paths.length} path(s).`,
          ]
        : []),
      ...read.problems,
    ]);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `Midst colours, ${SCHEME_NAMES[scheme]}\n${hexList(scheme, value)}`
      );
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const groups = Array.from(new Set(AUDITION_COLOURS.map((c) => c.group)));
  return (
    <div
      className={`${PANEL_CLASS}${left ? ' colour-audition-left' : ''}`}
      {...{ [KEEPS_FOCUS]: '' }}
      role="dialog"
      aria-label="Colours"
    >
      <div className="colour-audition-head">
        <span className="colour-audition-title">Colours</span>
        <button
          type="button"
          className="colour-audition-move"
          onClick={() => setLeft(!left)}
        >
          {left ? 'Move right' : 'Move left'}
        </button>
        <button type="button" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </button>
      </div>
      <div className="colour-audition-schemes" role="group" aria-label="Scheme">
        {SCHEMES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === scheme}
            onClick={() => setScheme(s)}
          >
            {SCHEME_NAMES[s]}
          </button>
        ))}
      </div>
      {scheme !== inForce && (
        <p className="colour-audition-note" role="note">
          The window is showing {SCHEME_NAMES[inForce]}. To see these colours,
          choose View &gt; Appearance &gt; {SCHEME_NAMES[scheme]}.
        </p>
      )}
      <div className="colour-audition-actions">
        <button type="button" onClick={copy}>
          Copy hex codes
        </button>
        {files && (
          <>
            <button type="button" onClick={exportSet}>
              Export to file…
            </button>
            <button type="button" onClick={importSet}>
              Import from file…
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => onChange({ ...choices, [scheme]: {} })}
          disabled={Object.keys(choices[scheme]).length === 0}
        >
          Revert all {SCHEME_NAMES[scheme]}
        </button>
        <span role="status">
          {copied === 'yes' && 'Copied.'}
          {copied === 'no' && 'Could not copy.'}
        </span>
      </div>
      {report && (
        <ul className="colour-audition-report" aria-label="File result">
          {report.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <section className="colour-audition-logo" aria-label="The squiggly M">
        <h3>The squiggly M</h3>
        {files && (
          <button type="button" onClick={loadLogoFile}>
            Load logo from file…
          </button>
        )}
        <button
          type="button"
          onClick={() => onLogoChange({ ...logo, custom: null })}
          disabled={!logo.custom}
        >
          Restore the original logo
        </button>
        <span id="colour-audition-outline-label">Outline thickness</span>
        <input
          id="colour-audition-outline"
          aria-labelledby="colour-audition-outline-label"
          type="range"
          min={0}
          max={MAX_OUTLINE}
          step={0.5}
          value={logo.outline}
          onChange={(e) =>
            onLogoChange({ ...logo, outline: Number(e.target.value) })
          }
        />
        <span aria-hidden="true">{logo.outline}</span>
      </section>
      <div className="colour-audition-list">
        {groups.map((group) => (
          <section key={group} aria-label={group}>
            <h3>{group}</h3>
            {AUDITION_COLOURS.filter((c) => c.group === group).map((c) => (
              <ColourRow
                key={`${scheme}-${c.id}`}
                colour={c}
                value={value(c)}
                chosen={choices[scheme][c.id] !== undefined}
                onChoose={(next) => set(c.id, next)}
                onRevert={() => set(c.id, undefined)}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

// Wraps the app: applies the chosen colours to the CSS variables and to MUI's theme, keeps them across
// restarts, and opens the panel from View > Colours….
export default function ColourAuditionHost({
  children,
}: {
  children: ReactNode;
}) {
  const inForce: Scheme = useMediaQuery('(prefers-color-scheme: dark)', {
    noSsr: true,
  })
    ? 'dark'
    : 'light';
  const [choices, setChoices] = useState<Choices>(() => {
    const kept = storage();
    return kept ? loadChoices(kept) : noChoices();
  });
  const [logo, setLogo] = useState<LogoState>(() => {
    const kept = storage();
    return kept ? loadLogo(kept) : NO_LOGO_CHANGE;
  });
  const [open, setOpen] = useState(false);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const style = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    const el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
    style.current = el;
    return () => {
      el.remove();
      style.current = null;
    };
  }, []);

  useEffect(() => {
    if (style.current)
      style.current.textContent = [cssText(choices), logoCss(logo.outline)]
        .filter(Boolean)
        .join('\n');
    const kept = storage();
    if (kept) saveChoices(kept, choices);
  }, [choices, logo.outline]);

  useEffect(() => {
    drawLogo(document, logo.custom);
    const kept = storage();
    if (kept) saveLogo(kept, logo);
  }, [logo]);

  useEffect(
    () =>
      window.electron.ipcRenderer.on('choose-colours', () => {
        // Read each time it opens, from the stylesheets as loaded, skipping this one's own.
        setDefaults(defaultsFrom(document, style.current?.sheet ?? null));
        setOpen(true);
      }),
    []
  );

  const theme = useMemo(
    () =>
      createTheme(
        themeWith(
          inForce === 'dark' ? darkThemeObj : themeObj,
          choices[inForce]
        )
      ),
    [inForce, choices]
  );

  return (
    <ThemeProvider theme={theme}>
      {children}
      {open && defaults && (
        <ColourPanel
          inForce={inForce}
          choices={choices}
          defaults={defaults}
          onChange={setChoices}
          onClose={() => setOpen(false)}
          logo={logo}
          onLogoChange={setLogo}
        />
      )}
    </ThemeProvider>
  );
}
