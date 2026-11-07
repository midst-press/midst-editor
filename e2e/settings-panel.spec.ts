import { test, expect, Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makePlayableMidst } from './fixtures';
import { launch, openDocument, shot } from './harness';

// GitHub #117: Annelyse's design for the Settings panel, checked in the running app item by item, with a screenshot in
// each scheme for a person to look at. Invented sentences and names only.

const LONG =
  'the quick brown fox jumps over the lazy dog and then sleeps for a while';
const MARK = 'Add a Draft Marker here';

async function openTimeline() {
  const doc = makePlayableMidst(LONG);
  const work = mkdtempSync(join(tmpdir(), 'midst-settings-'));
  const poemPath = join(work, 'settings.midst');
  writeFileSync(poemPath, doc.file);
  const { app, userData } = await launch(work);
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await openDocument(app, userData, poemPath, 'the long poem');
  await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
  await win.getByRole('link', { name: 'Timeline' }).click();
  await expect(win.locator('.ReplayContainer')).toBeVisible({
    timeout: 25_000,
  });
  // The bar grows in as the Timeline opens (MUI Grow): measure once it has.
  await expect
    .poll(() =>
      win.evaluate(
        () =>
          document.querySelector('.ControlBar')!.getBoundingClientRect().height
      )
    )
    .toBe(40);
  return { app, win, poemPath };
}

async function markHere(win: Page, name: string) {
  await win.getByRole('button', { name: MARK }).click();
  const field = win.getByLabel('Draft Marker name');
  await expect(field).toBeVisible({ timeout: 25_000 });
  await field.fill(name);
  await field.press('Enter');
  await expect(win.getByRole('button', { name })).toBeVisible();
}

// A colour as the page resolves it, for comparing with a computed style.
const resolved = (win: Page, value: string) =>
  win.evaluate((v) => {
    const probe = document.createElement('div');
    probe.style.color = v;
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, value);

// Everything the checks read from the open panel, in one pass.
const look = (win: Page) =>
  win.evaluate(() => {
    const panel = document.querySelector('.DraftDrawer') as HTMLElement;
    const box = (el: Element) => el.getBoundingClientRect();
    const style = (el: Element) => getComputedStyle(el);
    const header = panel.querySelector('.SettingsHeader')!;
    const h2 = panel.querySelector('h2')!;
    const h3 = panel.querySelector('h3')!;
    const list = panel.querySelector('ul')!;
    const timestamp = panel.querySelector('.ShowTimestamp')!;
    const texts = [
      h2,
      h3,
      ...Array.from(panel.querySelectorAll('.MuiFormControlLabel-label')),
      ...Array.from(panel.querySelectorAll('.draft-name')),
    ];
    const tracks = Array.from(panel.querySelectorAll('.MuiSwitch-root')).map(
      (root) => {
        const track = root.querySelector('.MuiSwitch-track')!;
        return {
          on: (root.querySelector('input') as HTMLInputElement).checked,
          track: style(track).backgroundColor,
          opacity: style(track).opacity,
          thumb: style(root.querySelector('.MuiSwitch-thumb')!).color,
        };
      }
    );
    const gear = Array.from(
      document.querySelectorAll('.ControlBar button')
    ).find((b) => b.getAttribute('aria-label') === 'Settings')!;
    // The h2's text, not its box, which is as wide as the header.
    const range = document.createRange();
    range.selectNodeContents(h2);
    const title = range.getBoundingClientRect();
    const headerBox = box(header);
    return {
      scheme: window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light',
      fonts: texts.map((t) => style(t).fontFamily),
      sizes: texts.map((t) => style(t).fontSize),
      jostLoaded: document.fonts.check('16px Jost'),
      names: Array.from(panel.querySelectorAll('.draft-name')).map(
        (b) => b.textContent
      ),
      dividerBottom: box(panel).bottom,
      barTop: box(document.querySelector('.ControlBar')!).top,
      divider: style(panel).borderLeftColor,
      dividerStyle: style(panel).borderLeftStyle,
      titleOffCentre: Math.abs(
        (title.left + title.right) / 2 - (headerBox.left + headerBox.right) / 2
      ),
      rule: {
        style: style(header).borderBottomStyle,
        colour: style(header).borderBottomColor,
        gapAboveIt: headerBox.bottom - title.bottom,
        sideMargins: [
          headerBox.left - box(panel).left,
          box(panel).right - headerBox.right,
        ],
      },
      belowTitle: box(h3).top - headerBox.bottom,
      belowDrafts: box(timestamp).top - box(list).bottom,
      // Between each switch and its label (GitHub #117, the gap she asked for after #458).
      switchGaps: Array.from(
        panel.querySelectorAll('.MuiFormControlLabel-root')
      ).map((label) => {
        const text = label.querySelector('.MuiFormControlLabel-label')!;
        const words = document.createRange();
        words.selectNodeContents(text);
        return (
          words.getBoundingClientRect().left -
          box(label.querySelector('.MuiSwitch-root')!).right
        );
      }),
      closeInHeader:
        box(panel.querySelector('.SettingsClose')!).right >
        (headerBox.left + headerBox.right) / 2,
      tracks,
      gear: style(gear).color,
    };
  });

test('the Settings panel as Annelyse designed it (GitHub #117)', async () => {
  const { app, win } = await openTimeline();
  try {
    // Made in this order, at the end and then the start: the list must follow the timeline, not this order (item 2).
    await markHere(win, 'zq');
    await win.locator('.MuiSlider-thumb input').focus();
    await win.keyboard.press('Home');
    await markHere(win, 'xv');

    await win.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(win.locator('.DraftDrawer')).toBeVisible();
    // The divider follows the timeline as it moves up for the names: wait for that to finish.
    await win.waitForTimeout(600);
    // Show timestamp starts off, so a switch of each kind is on screen.

    const pink = await resolved(win, 'var(--midst-switch-on)');
    const grey = await resolved(win, 'var(--midst-switch-off)');
    const white = await resolved(win, '#fff');
    const lavender = await resolved(win, '#b57edc');

    const checkScheme = async (scheme: 'light' | 'dark') => {
      await win.emulateMedia({ colorScheme: scheme });
      const seen = await look(win);
      expect(seen.scheme, 'the scheme did not change').toBe(scheme);
      await shot(app, win, test.info().outputPath(`settings-${scheme}.png`));

      // Item 1: the app's font, really loaded. Item 7: one size throughout.
      expect(seen.jostLoaded, 'Jost is not loaded').toBe(true);
      seen.fonts.forEach((f) => expect(f).toMatch(/^Jost\b/));
      expect(new Set(seen.sizes).size, `sizes: ${seen.sizes}`).toBe(1);

      // Item 2: the latest on the timeline on top.
      expect(seen.names).toEqual(['zq', 'xv']);

      // Item 3: down to just above the timeline, leaving a small gap; 3.5: a visible grey in dark too.
      const gap = seen.barTop - seen.dividerBottom;
      expect(
        gap,
        'the divider does not stop just above the timeline'
      ).toBeGreaterThanOrEqual(12);
      expect(gap).toBeLessThanOrEqual(20);
      expect(seen.dividerStyle).toBe('solid');
      expect(seen.divider).not.toBe('rgba(0, 0, 0, 0)');
      if (scheme === 'dark') {
        expect(seen.divider, 'the divider is not grey in dark').toBe(
          'rgb(107, 107, 107)'
        );
      }

      // Item 4: on is pink with a white circle, off is grey; every circle white.
      const on = seen.tracks.filter((t) => t.on);
      const off = seen.tracks.filter((t) => !t.on);
      expect(on.length).toBeGreaterThan(0);
      expect(off.length).toBeGreaterThan(0);
      if (scheme === 'light') {
        on.forEach((t) => expect(t.track).toBe(pink));
        off.forEach((t) => expect(t.track).toBe(grey));
        seen.tracks.forEach((t) => expect(t.opacity).toBe('1'));
      }
      seen.tracks.forEach((t) => expect(t.thumb).toBe(white));

      // Item 5: the title centred, a dotted line under it with a little space between and small side margins.
      expect(seen.titleOffCentre).toBeLessThanOrEqual(1);
      expect(seen.rule.style).toBe('dotted');
      expect(seen.rule.gapAboveIt).toBeGreaterThan(2);
      seen.rule.sideMargins.forEach((m) => {
        expect(m).toBeGreaterThan(0);
        expect(m).toBeLessThanOrEqual(24);
      });

      // Item 6: the X at the right of the title, and room under the title. Item 8: room under the drafts.
      expect(seen.closeInHeader).toBe(true);
      seen.switchGaps.forEach((between) =>
        expect(between, 'a switch touches its label').toBeGreaterThanOrEqual(4)
      );
      expect(seen.belowTitle).toBeGreaterThanOrEqual(24);
      expect(seen.belowDrafts).toBeGreaterThanOrEqual(24);

      // Item 11: the gear in the active colour while the panel is open.
      expect(seen.gear).toBe(lavender);
    };
    await checkScheme('light');
    await checkScheme('dark');
    await win.emulateMedia({ colorScheme: 'light' });

    // Item 9: a name typed in Settings stops at the end of its field.
    await win
      .getByRole('button', { name: 'Rename Draft Marker' })
      .first()
      .click();
    const field = win.getByLabel('Draft Marker name');
    await expect(field).toBeVisible();
    await field.press('ControlOrMeta+a');
    await field.pressSequentially('m'.repeat(60));
    const typed = await field.evaluate((el) => {
      const input = el as HTMLInputElement;
      return {
        length: input.value.length,
        fits: input.scrollWidth <= input.clientWidth,
      };
    });
    expect(typed.length, 'the name was not stopped').toBeLessThan(60);
    expect(typed.length).toBeGreaterThan(5);
    expect(typed.fits, 'the name runs past its field').toBe(true);
    await field.press('Enter');

    // Item 6: the X closes it, and the gear stops being active.
    await win.getByRole('button', { name: 'Close Settings' }).click();
    await expect(win.locator('.DraftDrawer')).toBeHidden();
    const gear = win.getByRole('button', { name: 'Settings', exact: true });
    await expect(gear).toBeFocused();
    expect(await gear.evaluate((g) => getComputedStyle(g).color)).toBe(
      await resolved(win, 'var(--midst-on-control-bar)')
    );
  } finally {
    await app.close();
  }
});

// GitHub #117, Annelyse's answers: default names follow the Timeline, a deleted draft's row holds Undo in its place,
// and once that time is up the row fades and the list closes up. In the file, because the file is what a poet keeps.
test('numbers follow the Timeline, and Undo is in the deleted row (GitHub #117)', async () => {
  const { app, win, poemPath } = await openTimeline();
  const metaOnDisk = () =>
    JSON.parse(readFileSync(poemPath, 'utf8').split('\n').slice(1).join('\n'))
      .meta;
  try {
    const keep = async () => {
      await win.getByRole('button', { name: MARK }).click();
      const field = win.getByLabel('Draft Marker name');
      await expect(field).toBeVisible({ timeout: 25_000 });
      const name = await field.inputValue();
      await field.press('Enter');
      await expect(field).toHaveCount(0);
      return name;
    };
    const thumb = win.locator('.MuiSlider-thumb input');
    // Made at the end, then at the start, then in the middle.
    expect(await keep()).toBe('Draft 1');
    await thumb.focus();
    await win.keyboard.press('Home');
    expect(await keep(), 'a draft made before the first is Draft 1').toBe(
      'Draft 1'
    );
    await thumb.focus();
    await win.keyboard.press('PageUp');
    await win.keyboard.press('PageUp');
    expect(await keep()).toBe('Draft 2');

    await win.getByRole('button', { name: 'Settings', exact: true }).click();
    const names = () =>
      win
        .locator('.DraftDrawer li')
        .evaluateAll((rows) => rows.map((r) => r.textContent));
    await expect.poll(names).toEqual(['Draft 3', 'Draft 2', 'Draft 1']);
    // The file says the same, whatever order they were made in.
    await expect
      .poll(() =>
        (metaOnDisk().draftMarkers as { index: number; defaultName: string }[])
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((m) => m.defaultName)
      )
      .toEqual(['Draft 1', 'Draft 2', 'Draft 3']);

    // Delete the middle one: its row says so, Undo at its end, in its place.
    await win
      .getByRole('button', { name: 'Delete Draft Marker' })
      .nth(1)
      .click();
    await expect
      .poll(names)
      .toEqual(['Draft 2', 'Draft Marker deleted.Undo', 'Draft 1']);
    const row = win.locator('.DraftDeleted');
    const undoRow = await row.evaluate((li) => {
      const em = li.querySelector('em')!.getBoundingClientRect();
      const undo = li.querySelector('button')!;
      const b = undo.getBoundingClientRect();
      const r = li.getBoundingClientRect();
      const style = getComputedStyle(undo);
      return {
        italic: getComputedStyle(li.querySelector('em')!).fontStyle,
        textAtLeft: em.left - r.left,
        undoAtRight: r.right - b.right,
        undoFont: style.fontFamily,
        radius: parseFloat(style.borderTopLeftRadius),
      };
    });
    expect(undoRow.italic).toBe('italic');
    expect(undoRow.textAtLeft).toBeLessThanOrEqual(8);
    expect(undoRow.undoAtRight).toBeLessThanOrEqual(2);
    expect(undoRow.undoFont).toMatch(/^Jost\b/);
    expect(undoRow.radius).toBeGreaterThan(0);
    await shot(app, win, test.info().outputPath('undo-row-light.png'));
    await win.emulateMedia({ colorScheme: 'dark' });
    await shot(app, win, test.info().outputPath('undo-row-dark.png'));
    await win.emulateMedia({ colorScheme: 'light' });

    // Undo puts it back, numbered again.
    await win.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(names).toEqual(['Draft 3', 'Draft 2', 'Draft 1']);

    // Delete it again and let the time run out: the row fades, the list closes up, the numbers close the gap.
    await win
      .getByRole('button', { name: 'Delete Draft Marker' })
      .nth(1)
      .click();
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/leaving/, { timeout: 8_000 });
    await expect(row).toHaveCount(0, { timeout: 2_000 });
    await expect.poll(names).toEqual(['Draft 2', 'Draft 1']);
    await expect
      .poll(() => metaOnDisk().draftMarkers.length, { timeout: 10_000 })
      .toBe(2);
    await shot(app, win, test.info().outputPath('after-delete.png'));
  } finally {
    await app.close();
  }
});
