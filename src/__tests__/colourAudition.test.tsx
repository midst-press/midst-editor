/* eslint-disable lingui/no-unlocalized-strings -- the audition tool is English only (GitHub #119) */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
import { readFileSync } from 'fs';
import { join } from 'path';
import themeObj, { darkThemeObj } from '../renderer/theme';
import { CSS_VARS, CssVarKey } from '../renderer/cssVars';
import {
  AUDITION_COLOURS,
  STORAGE_KEY,
  cssText,
  loadChoices,
  applyImported,
  hexList,
  noChoices,
  parseColour,
  parseHexList,
  saveChoices,
  themeWith,
  toHex,
  withRgb,
} from '../renderer/colourAudition/colours';
import { defaultsFrom } from '../renderer/colourAudition/defaults';
import {
  LOGO_STORAGE_KEY,
  NO_LOGO_CHANGE,
  forgetOriginalLogo,
} from '../renderer/colourAudition/logo';
import KEEPS_FOCUS from '../renderer/keepsFocus';
import ColourAuditionHost, {
  ColourPanel,
  STYLE_ID,
} from '../renderer/colourAudition/ColourAudition';

// View > Colours… (GitHub #119): Annelyse auditions the app's colours, light and dark, in an audition build.

const ROOT_CSS = readFileSync(
  join(__dirname, '..', 'renderer', 'cssVars.css'),
  'utf8'
);
const themes = {
  light: createTheme(themeObj),
  dark: createTheme(darkThemeObj),
};

describe('the colours offered', () => {
  it('include every CSS variable the app draws with, once each', () => {
    const offered = AUDITION_COLOURS.flatMap((c) => (c.css ? [c.css] : []));
    expect([...offered].sort()).toEqual(Object.keys(CSS_VARS).sort());
  });

  it('have distinct ids', () => {
    const ids = AUDITION_COLOURS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A variable taken `from` the theme is the same colour as its palette entry, so one choice sets both.
  it.each(['light', 'dark'] as const)(
    'pair each theme-derived variable with the palette entry it comes from, in %s',
    (scheme) => {
      const theme = themes[scheme];
      AUDITION_COLOURS.filter(
        (c) => c.css && 'from' in CSS_VARS[c.css]
      ).forEach((c) => {
        expect(c.palette).toBeDefined();
        const [section, field] = (c.palette as string).split('.');
        const fromPalette = (
          theme.palette as unknown as Record<string, Record<string, string>>
        )[section][field];
        const { from } = CSS_VARS[c.css as CssVarKey] as {
          from: typeof CSS_VARS.background.from;
        };
        expect(fromPalette).toBe(from(theme));
      });
    }
  );
});

describe('colour values', () => {
  it.each([
    ['#fff', '#ffffff'],
    ['#fff9', '#ffffff99'],
    ['DodgerBlue', '#1e90ff'],
    ['#0000', '#00000000'],
    ['#FFF5EE', '#fff5ee'],
    ['rgb(255, 182, 199)', '#ffb6c7'],
    ['rgba(0, 0, 0, 0.87)', '#000000de'],
    ['#ffa4b980', '#ffa4b980'],
  ])('reads %s as %s', (value, hex) => {
    const rgba = parseColour(value);
    expect(rgba).not.toBeNull();
    expect(toHex(rgba!)).toBe(hex);
  });

  it.each([
    'tomato',
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'rgb(300, 0, 0)',
    'rgba(0,0,0,2)',
    '#12',
    '#12345',
    'red; } body { display: none',
    'rgba(1, 2, 3, .)',
    'rgba(1, 2, 3, 0..5)',
  ])('does not read %s', (value) => expect(parseColour(value)).toBeNull());

  it('reports a line naming an Object property as not a colour, without throwing', () => {
    expect(
      parseHexList('Midst colours, Light\nText / Link [link]: constructor')
        .problems
    ).toEqual(['"constructor" is not a colour: Text / Link [link].']);
  });

  it('keeps the transparency a colour had when the RGB is picked', () => {
    expect(withRgb('#ff0000', 'rgba(0, 0, 0, 0.5)')).toBe('#ff000080');
    expect(withRgb('#ff0000', '#00ff00')).toBe('#ff0000');
    expect(withRgb('not a colour', '#00ff00')).toBeNull();
  });
});

describe('applying choices', () => {
  it('is no CSS at all when nothing is chosen', () => {
    expect(cssText(noChoices())).toBe('');
  });

  it('sets the chosen variables over cssVars.css, light at the root and dark in its media block', () => {
    const text = cssText({
      light: { background: '#ffffff', secondary: '#123456' },
      dark: { divider: '#333333' },
    });
    expect(text).toContain(':root:root { --midst-background: #ffffff; }');
    expect(text).toContain(
      '@media (prefers-color-scheme: dark) { :root:root { --midst-divider: #333333; } }'
    );
    // The palette-only colour has no variable to set.
    expect(text).not.toContain('#123456');
  });

  it('puts the chosen palette colours into a copy of the theme', () => {
    const before = JSON.stringify(themeObj);
    const options = themeWith(themeObj, {
      primary: '#010203',
      secondary: '#040506',
    });
    expect(createTheme(options).palette.primary.main).toBe('#010203');
    expect(createTheme(options).palette.secondary.main).toBe('#040506');
    expect(createTheme(options).palette.background.default).toBe('#FFF5EE');
    expect(JSON.stringify(themeObj)).toBe(before);
  });
});

describe('keeping choices', () => {
  const store = (value: string | null) => ({ getItem: () => value });

  it('reads back what was saved', () => {
    const saved: Record<string, string> = {};
    const choices = {
      light: { background: '#ffffff' },
      dark: { link: '#00ff00' },
    };
    expect(
      saveChoices(
        {
          setItem: (k, v) => {
            saved[k] = v;
          },
        },
        choices
      )
    ).toBe(true);
    expect(loadChoices(store(saved[STORAGE_KEY]))).toEqual(choices);
  });

  it.each([null, 'not json', '42', '{"light": "x"}'])(
    'is none for %s',
    (raw) => {
      expect(loadChoices(store(raw))).toEqual(noChoices());
    }
  );

  it('drops unknown colours and anything that is not a colour', () => {
    const raw = JSON.stringify({
      light: {
        background: 'red; } body { display: none',
        nonsense: '#ffffff',
        link: '#00ff00',
      },
      dark: { divider: 7 },
    });
    expect(loadChoices(store(raw))).toEqual({
      light: { link: '#00ff00' },
      dark: {},
    });
  });

  it('says so when it cannot save', () => {
    expect(
      saveChoices(
        {
          setItem: () => {
            throw new Error('full');
          },
        },
        noChoices()
      )
    ).toBe(false);
  });
});

describe('the defaults', () => {
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = ROOT_CSS;
    document.head.appendChild(style);
  });
  afterEach(() => style.remove());

  // Every default, written out as Export writes it and read back as Import reads it, comes back as itself with
  // nothing refused (Violet, VM check of #486: dark mutedText's #fff9 was refused).
  it('survive a file round trip, every one, in both schemes', () => {
    const defaults = defaultsFrom(document, null);
    const text = (['light', 'dark'] as const)
      .map(
        (s) =>
          `Midst colours, ${s === 'light' ? 'Light' : 'Dark'}\n${hexList(s, (c) => defaults[s][c.id], true)}`
      )
      .join('\n\n');
    const read = parseHexList(text);
    expect(read.problems).toEqual([]);
    (['light', 'dark'] as const).forEach((s) =>
      AUDITION_COLOURS.forEach((c) =>
        expect(read.colours[s]?.[c.id]).toBe(
          toHex(parseColour(defaults[s][c.id])!)
        )
      )
    );
  });

  it('are cssVars.css as the page loaded it, light and dark, and the themes for palette-only colours', () => {
    const defaults = defaultsFrom(document, null);
    expect(defaults.light.background).toBe('#fff5ee');
    expect(defaults.dark.background).toBe('#1f1a1c');
    expect(defaults.dark.controlBar).toBe('#4a2f38');
    expect(defaults.light.secondary).toBe('#FFA4B9');
    expect(defaults.dark.paper).toBe('#2B2427');
    AUDITION_COLOURS.forEach((c) => {
      expect(defaults.light[c.id]).not.toBe('');
      expect(defaults.dark[c.id]).not.toBe('');
    });
  });

  it("never take the audition's own choices for defaults", () => {
    const own = document.createElement('style');
    own.textContent = ':root { --midst-background: #000001; }';
    document.head.appendChild(own);
    try {
      expect(defaultsFrom(document, own.sheet).light.background).toBe(
        '#fff5ee'
      );
    } finally {
      own.remove();
    }
  });
});

describe('the panel', () => {
  const defaults = {
    light: Object.fromEntries(AUDITION_COLOURS.map((c) => [c.id, '#aaaaaa'])),
    dark: Object.fromEntries(AUDITION_COLOURS.map((c) => [c.id, '#222222'])),
  };
  const hexBox = (label: string) =>
    screen.getByLabelText(`${label}, hex code`) as HTMLInputElement;

  it('chooses a typed hex code for the scheme shown, and reverts it', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <ColourPanel
        inForce="light"
        choices={noChoices()}
        defaults={defaults}
        onChange={onChange}
        onClose={jest.fn()}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    fireEvent.change(hexBox('Background'), { target: { value: '#123456' } });
    fireEvent.blur(hexBox('Background'));
    expect(onChange).toHaveBeenLastCalledWith({
      light: { background: '#123456' },
      dark: {},
    });

    rerender(
      <ColourPanel
        inForce="light"
        choices={{ light: { background: '#123456' }, dark: {} }}
        defaults={defaults}
        onChange={onChange}
        onClose={jest.fn()}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    expect(hexBox('Background').value).toBe('#123456');
    fireEvent.click(screen.getByLabelText('Background, revert'));
    expect(onChange).toHaveBeenLastCalledWith({ light: {}, dark: {} });
  });

  it('refuses a hex code it cannot read, and says so', () => {
    const onChange = jest.fn();
    render(
      <ColourPanel
        inForce="light"
        choices={noChoices()}
        defaults={defaults}
        onChange={onChange}
        onClose={jest.fn()}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    fireEvent.change(hexBox('Link'), { target: { value: '#12' } });
    fireEvent.keyDown(hexBox('Link'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(hexBox('Link')).toHaveAttribute('aria-invalid', 'true');
  });

  it('edits the dark scheme separately, and says how to see it', () => {
    const onChange = jest.fn();
    render(
      <ColourPanel
        inForce="light"
        choices={noChoices()}
        defaults={defaults}
        onChange={onChange}
        onClose={jest.fn()}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(screen.getByRole('note')).toHaveTextContent(
      'View > Appearance > Dark'
    );
    expect(hexBox('Background').value).toBe('#222222');
    fireEvent.change(hexBox('Background'), { target: { value: '#010101' } });
    fireEvent.blur(hexBox('Background'));
    expect(onChange).toHaveBeenLastCalledWith({
      light: {},
      dark: { background: '#010101' },
    });
  });

  it('copies every hex code of the scheme shown', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <ColourPanel
        inForce="light"
        choices={{ light: { link: '#00ff00' }, dark: {} }}
        defaults={defaults}
        onChange={jest.fn()}
        onClose={jest.fn()}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy hex codes' }));
    });
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('Text / Link: #00ff00');
    expect(copied).toContain('Background (the beige) / Background: #aaaaaa');
    expect(copied.split('\n')).toHaveLength(AUDITION_COLOURS.length + 1);
    expect(screen.getByRole('status')).toHaveTextContent('Copied.');
  });

  it('is marked so the editor leaves it the focus, and moves to the other side', () => {
    render(
      <ColourPanel
        inForce="light"
        choices={noChoices()}
        defaults={defaults}
        onChange={jest.fn()}
        onClose={jest.fn()}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    const panel = screen.getByRole('dialog', { name: 'Colours' });
    expect(panel).toHaveAttribute(KEEPS_FOCUS);
    expect(panel).not.toHaveClass('colour-audition-left');
    fireEvent.click(screen.getByRole('button', { name: 'Move left' }));
    expect(panel).toHaveClass('colour-audition-left');
    fireEvent.click(screen.getByRole('button', { name: 'Move right' }));
    expect(panel).not.toHaveClass('colour-audition-left');
  });

  it('closes on Escape', () => {
    const onClose = jest.fn();
    render(
      <ColourPanel
        inForce="light"
        choices={noChoices()}
        defaults={defaults}
        onChange={jest.fn()}
        onClose={onClose}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    fireEvent.keyDown(hexBox('Link'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('the host', () => {
  let opened: (() => void) | undefined;
  beforeEach(() => {
    opened = undefined;
    window.localStorage.clear();
    Object.assign(window, {
      electron: {
        ipcRenderer: {
          on: (channel: string, listener: () => void) => {
            if (channel === 'choose-colours') opened = listener;
            return () => {};
          },
        },
      },
    });
  });

  it('opens from View > Colours…, applies a choice to the page and keeps it across a restart', () => {
    const { unmount } = render(
      <ColourAuditionHost>
        <p>poem</p>
      </ColourAuditionHost>
    );
    expect(screen.getByText('poem')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => opened!());
    expect(screen.getByRole('dialog', { name: 'Colours' })).toBeInTheDocument();

    const box = screen.getByLabelText('Settings divider, hex code');
    fireEvent.change(box, { target: { value: '#abcdef' } });
    fireEvent.blur(box);
    expect(document.getElementById(STYLE_ID)?.textContent).toContain(
      '--midst-divider: #abcdef;'
    );
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).light.divider
    ).toBe('#abcdef');

    unmount();
    expect(document.getElementById(STYLE_ID)).toBeNull();
    render(
      <ColourAuditionHost>
        <p>poem</p>
      </ColourAuditionHost>
    );
    expect(document.getElementById(STYLE_ID)?.textContent).toContain(
      '--midst-divider: #abcdef;'
    );
  });

  // GitHub #119: the logo and its outline are drawn and kept across a restart.
  it('draws a kept logo and its outline after a restart', () => {
    forgetOriginalLogo();
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div id="logo-host"><svg id="svg" class="svg" viewBox="0 0 182.2 96"><path d="M5 5"></path></svg></div>'
    );
    window.localStorage.setItem(
      LOGO_STORAGE_KEY,
      JSON.stringify({
        custom: { viewBox: '0 0 10 10', paths: ['M0 0L1 1'] },
        outline: 2,
      })
    );
    const { unmount } = render(
      <ColourAuditionHost>
        <p>poem</p>
      </ColourAuditionHost>
    );
    const drawn = document.getElementById('svg')!;
    expect(drawn.getAttribute('viewBox')).toBe('0 0 10 10');
    expect(drawn.querySelector('path')?.getAttribute('d')).toBe('M0 0L1 1');
    expect(document.getElementById(STYLE_ID)?.textContent).toContain(
      'stroke-width: 2;'
    );
    act(() => opened!());
    fireEvent.click(
      screen.getByRole('button', { name: 'Restore the original logo' })
    );
    expect(drawn.getAttribute('viewBox')).toBe('0 0 182.2 96');
    expect(drawn.querySelector('path')?.getAttribute('d')).toBe('M5 5');
    expect(JSON.parse(window.localStorage.getItem(LOGO_STORAGE_KEY)!)).toEqual({
      custom: null,
      outline: 2,
    });
    unmount();
    document.getElementById('logo-host')?.remove();
  });
});

// GitHub #119: saved sets are read back in, and every export so far must still import (Stuart, 10 Nov).
describe('reading a saved set', () => {
  const hex = (i: number) =>
    `#${(0x100000 + i * 0x0a0b0c).toString(16).slice(-6)}`;
  const lineFor = (
    c: (typeof AUDITION_COLOURS)[number],
    i: number,
    group: string,
    label: string,
    tag: boolean
  ) => `${group} / ${label}${tag ? ` [${c.id}]` : ''}: ${hex(i)}`;
  const all = Object.fromEntries(
    AUDITION_COLOURS.map((c, i) => [c.id, hex(i)])
  );

  it('reads back both sections that hexList writes, with ids or without', () => {
    const plain = parseHexList(
      `Midst colours, Light\n${hexList('light', (c) => all[c.id])}`
    );
    expect(plain).toEqual({ colours: { light: all }, problems: [] });
    const text = [
      `Midst colours, Light\n${hexList('light', (c) => all[c.id], true)}`,
      `Midst colours, Dark\n${hexList('dark', (c) => all[c.id], true)}`,
    ].join('\n\n');
    const read = parseHexList(text);
    expect(read.problems).toEqual([]);
    expect(read.colours.light).toEqual(all);
    expect(read.colours.dark).toEqual(all);
  });

  // Frida's build (90d71ee): no [id], and two labels #484 renamed.
  it('imports a 90d71ee export completely, old labels included', () => {
    const OLD: Record<string, string> = {
      primaryDark: 'Primary, darker',
      logo: 'Logo',
    };
    const text = [
      'Midst colours, Dark',
      ...AUDITION_COLOURS.map((c, i) =>
        lineFor(c, i, c.group, OLD[c.id] ?? c.label, false)
      ),
    ].join('\n');
    const read = parseHexList(text);
    expect(read.problems).toEqual([]);
    expect(read.colours.dark).toEqual(all);
    expect(read.colours.light).toBeUndefined();
  });

  it('imports an export from before #483, with the old group names', () => {
    const OLD_GROUP: Record<string, string> = {
      'Background (the beige)': 'Primary (the beige)',
      'Pinks (primary and secondary)': 'Secondary (the pink)',
    };
    const OLD: Record<string, string> = {
      primaryDark: 'Primary, darker',
      logo: 'Logo',
    };
    const text = [
      'Midst colours, Light',
      ...AUDITION_COLOURS.map((c, i) =>
        lineFor(
          c,
          i,
          OLD_GROUP[c.group] ?? c.group,
          OLD[c.id] ?? c.label,
          false
        )
      ),
    ].join('\n');
    expect(parseHexList(text)).toEqual({
      colours: { light: all },
      problems: [],
    });
  });

  it('matches by [id] whatever the label now says', () => {
    const read = parseHexList(
      'Midst colours, Light\nAnything / Renamed one day [link]: #010203'
    );
    expect(read).toEqual({
      colours: { light: { link: '#010203' } },
      problems: [],
    });
  });

  it('reports what it cannot use, and applies the rest', () => {
    const read = parseHexList(
      [
        'stray line',
        'Midst colours, Light',
        'Text / Link [link]: #010203',
        'Text / Nonexistent: #010203',
        'Text / Problem [errorLight]: not-a-colour',
        'Text / Unknown [nosuch]: #010203',
      ].join('\n')
    );
    expect(read.colours).toEqual({ light: { link: '#010203' } });
    expect(read.problems).toHaveLength(4);
    expect(read.problems.join('\n')).toMatch(/stray line/);
    expect(read.problems.join('\n')).toMatch(/Nonexistent/);
    expect(read.problems.join('\n')).toMatch(/not-a-colour/);
    expect(read.problems.join('\n')).toMatch(/nosuch/);
  });

  it('says so when there is no heading at all', () => {
    expect(parseHexList('').problems).toHaveLength(1);
  });

  it('applies each section to its own tab, and a colour at its default is no change', () => {
    const defaults = {
      light: { link: '#0000ff', divider: '#111111' },
      dark: { link: '#9ec5ff' },
    };
    const before = { light: { divider: '#222222' }, dark: { link: '#123456' } };
    const next = applyImported(before, defaults, {
      colours: { light: { link: '#0000ff', divider: '#333333' } },
      problems: [],
    });
    expect(next).toEqual({
      light: { divider: '#333333' },
      dark: { link: '#123456' },
    });
    expect(before).toEqual({
      light: { divider: '#222222' },
      dark: { link: '#123456' },
    });
  });
});

describe('the panel, saving and reading a file', () => {
  const defaults = {
    light: Object.fromEntries(AUDITION_COLOURS.map((c) => [c.id, '#aaaaaa'])),
    dark: Object.fromEntries(AUDITION_COLOURS.map((c) => [c.id, '#222222'])),
  };
  afterEach(() => {
    delete (window as unknown as { electron?: unknown }).electron;
  });

  it('exports both schemes, with ids, and imports a set into its own tab', () => {
    const exportSet = jest
      .fn()
      .mockReturnValue({ ok: true, path: '/x/Midst colours.txt' });
    const importSet = jest.fn().mockReturnValue({
      ok: true,
      path: '/x/a.txt',
      text: 'Midst colours, Dark\nText / Link [link]: #010203',
    });
    Object.assign(window, {
      electron: { colourFiles: { exportSet, importSet } },
    });
    const onChange = jest.fn();
    render(
      <ColourPanel
        inForce="light"
        choices={{ light: { link: '#00ff00' }, dark: {} }}
        defaults={defaults}
        onChange={onChange}
        onClose={jest.fn()}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export to file…' }));
    const written = exportSet.mock.calls[0][0] as string;
    expect(written).toContain('Midst colours, Light');
    expect(written).toContain('Midst colours, Dark');
    expect(written).toContain('Text / Link [link]: #00ff00');
    expect(written).toContain('Text / Link [link]: #222222');

    fireEvent.click(screen.getByRole('button', { name: 'Import from file…' }));
    expect(onChange).toHaveBeenLastCalledWith({
      light: { link: '#00ff00' },
      dark: { link: '#010203' },
    });
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('list', { name: 'File result' })).toHaveTextContent(
      'Read 1 colours into Dark.'
    );
  });

  // Main sends a refusal as a code; the panel says it in words, and says nothing when the poet cancelled.
  it.each([
    [
      'export',
      'Export to file…',
      { failure: 'poem' },
      'A colour set is never a .midst file, so no poem was touched.',
    ],
    [
      'export',
      'Export to file…',
      { failure: 'unwritable', error: 'disk full' },
      'Could not save: disk full',
    ],
    [
      'import',
      'Import from file…',
      { failure: 'tooLarge' },
      'That file is too large to be a colour set.',
    ],
    [
      'import',
      'Import from file…',
      { failure: 'unreadable', error: 'no access' },
      'Could not read: no access',
    ],
  ])('says why a file %s was refused: %s', (_kind, button, refusal, words) => {
    const call = jest.fn().mockReturnValue({ ok: false, ...refusal });
    Object.assign(window, {
      electron: { colourFiles: { exportSet: call, importSet: call } },
    });
    render(
      <ColourPanel
        inForce="light"
        choices={noChoices()}
        defaults={defaults}
        onChange={jest.fn()}
        onClose={jest.fn()}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: button }));
    // The words for main's dialog are the last argument, whichever the call.
    expect(call.mock.calls[0].at(-1)).toEqual({
      filterName: 'Text',
      defaultName: 'Midst colours.txt',
    });
    expect(screen.getByRole('list', { name: 'File result' })).toHaveTextContent(
      words
    );
  });

  it('says nothing when the file dialog is cancelled', () => {
    const call = jest.fn().mockReturnValue({ ok: false, failure: 'cancelled' });
    Object.assign(window, {
      electron: { colourFiles: { exportSet: call, importSet: call } },
    });
    render(
      <ColourPanel
        inForce="light"
        choices={noChoices()}
        defaults={defaults}
        onChange={jest.fn()}
        onClose={jest.fn()}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export to file…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import from file…' }));
    expect(screen.queryByRole('list', { name: 'File result' })).toBeNull();
  });

  // GitHub #119: the squiggly M, from a file, with an outline, and put back.
  describe('the logo', () => {
    const SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L1 1"/><circle r="1"/></svg>';
    const panel = (readLogo: jest.Mock, logo = NO_LOGO_CHANGE) => {
      Object.assign(window, {
        electron: {
          colourFiles: { exportSet: jest.fn(), importSet: jest.fn(), readLogo },
        },
      });
      const onLogoChange = jest.fn();
      render(
        <ColourPanel
          inForce="light"
          choices={noChoices()}
          defaults={defaults}
          onChange={jest.fn()}
          onClose={jest.fn()}
          logo={logo}
          onLogoChange={onLogoChange}
        />
      );
      return onLogoChange;
    };

    it('draws a logo read from a file, and says what it left out', () => {
      const readLogo = jest
        .fn()
        .mockReturnValue({ ok: true, path: '/x/l.svg', text: SVG });
      const onLogoChange = panel(readLogo);
      fireEvent.click(
        screen.getByRole('button', { name: 'Load logo from file…' })
      );
      expect(readLogo).toHaveBeenCalledWith({
        filterName: 'SVG drawing',
        defaultName: 'Midst logo.svg',
      });
      expect(onLogoChange).toHaveBeenCalledWith({
        custom: { viewBox: '0 0 10 10', paths: ['M0 0L1 1'] },
        outline: 0,
      });
      const report = screen.getByRole('list', { name: 'File result' });
      expect(report).toHaveTextContent(
        'Drew the logo from /x/l.svg, 1 path(s).'
      );
      expect(report).toHaveTextContent(
        '1 shape(s) that are not paths were left out.'
      );
    });

    it.each([
      [
        { ok: false, failure: 'tooLarge' },
        'That file is too large to be a logo.',
      ],
      [
        { ok: false, failure: 'poem' },
        'That is a poem, not a logo, so it was not read.',
      ],
      [
        { ok: true, path: '/x/l.svg', text: 'not a drawing' },
        'That file is not an SVG drawing.',
      ],
    ])('draws nothing when the file is refused: %p', (result, words) => {
      const onLogoChange = panel(jest.fn().mockReturnValue(result));
      fireEvent.click(
        screen.getByRole('button', { name: 'Load logo from file…' })
      );
      expect(onLogoChange).not.toHaveBeenCalled();
      expect(
        screen.getByRole('list', { name: 'File result' })
      ).toHaveTextContent(words);
    });

    it('puts the original back only when there is a replacement, and sets the outline', () => {
      const onLogoChange = panel(jest.fn(), {
        custom: { viewBox: '0 0 1 1', paths: ['M0 0'] },
        outline: 1,
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Restore the original logo' })
      );
      expect(onLogoChange).toHaveBeenLastCalledWith({
        custom: null,
        outline: 1,
      });
      fireEvent.change(
        screen.getByRole('slider', { name: 'Outline thickness' }),
        {
          target: { value: '2.5' },
        }
      );
      expect(onLogoChange).toHaveBeenLastCalledWith({
        custom: { viewBox: '0 0 1 1', paths: ['M0 0'] },
        outline: 2.5,
      });
    });

    it('cannot put the original back when it was never replaced', () => {
      panel(jest.fn());
      expect(
        screen.getByRole('button', { name: 'Restore the original logo' })
      ).toBeDisabled();
    });
  });

  it('shows no file buttons where there is no file bridge', () => {
    render(
      <ColourPanel
        inForce="light"
        choices={noChoices()}
        defaults={defaults}
        onChange={jest.fn()}
        onClose={jest.fn()}
        logo={NO_LOGO_CHANGE}
        onLogoChange={jest.fn()}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Export to file…' })
    ).toBeNull();
  });
});
