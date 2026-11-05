import { test, expect, Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makePlayableMidst } from './fixtures';
import { launch, openDocument, shot, waitUntil } from './harness';

// Can a poet mark a draft, name it, and delete it, and is that what the saved file holds?
//
// Driven through the real controls and checked in the FILE, because the file is what a poet keeps.
// Invented sentences only.

// More than 50 recorded changes: the original editor allowed markers only past that.
const LONG =
  'the quick brown fox jumps over the lazy dog and then sleeps for a while';
const SHORT = 'a short line';

const metaOnDisk = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8').split('\n').slice(1).join('\n')).meta;
const MARK = 'Add a Draft Marker here';

test('a draft is marked from the editor, named, joined by a second, and deleted', async () => {
  const doc = makePlayableMidst(LONG);
  const last = doc.history.length - 1;
  expect(
    doc.history.length,
    'the fixture needs more than 50 changes'
  ).toBeGreaterThan(50);

  const work = mkdtempSync(join(tmpdir(), 'midst-drafts-'));
  const poemPath = join(work, 'drafts.midst');
  writeFileSync(poemPath, doc.file);
  // CONTROL: the file starts with no meta at all, so every marker below was put there by the app.
  expect(metaOnDisk(poemPath)).toBeUndefined();

  const { app, userData } = await launch(work);
  const failures: string[] = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => failures.push(`pageerror: ${String(e)}`));
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the long poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });

    // 1. From the editor: marks the latest moment and goes to the Timeline with its name open there, not in
    // Settings (GitHub #95).
    await win.getByRole('button', { name: MARK }).click();
    const nameField = win.getByLabel('Draft Marker name');
    await expect(nameField, 'the name did not open for typing').toBeVisible({
      timeout: 25_000,
    });
    await expect(nameField).toHaveValue('Draft 1');
    await expect(
      win.locator('.MuiSlider-markLabel .draft-mark-name')
    ).toHaveCount(1);
    await expect(win.locator('.DraftDrawer')).toBeHidden();
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath)?.draftMarkers?.length === 1,
        10_000
      ),
      'the new marker never reached the file'
    ).toBe(true);
    expect(metaOnDisk(poemPath)).toEqual({
      draftMarkers: [{ index: last, defaultName: 'Draft 1' }],
      highestDraftNumber: 1,
    });

    // 2. Name it. Space is typed into the name, not taken as play. Enter keeps it and, since it was made
    // while writing, goes back to writing.
    await nameField.fill('zq xv');
    await nameField.press('Enter');
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath).draftMarkers[0].name === 'zq xv',
        10_000
      ),
      'the name never reached the file'
    ).toBe(true);
    await expect(
      win.locator('.ReplayContainer'),
      'Enter on a marker made while writing did not go back to writing'
    ).toBeHidden();
    await expect(win.locator('.ProseMirror')).toBeVisible();

    // 3. Back on the Timeline. One marker per moment: here the button is off.
    await win.getByRole('link', { name: 'Timeline' }).click();
    await expect(win.locator('.ReplayContainer')).toBeVisible({
      timeout: 25_000,
    });
    const mark = win.getByRole('button', { name: MARK });
    await expect(mark).toBeDisabled();

    // With Settings open and nothing in it touched yet, Enter stays with the list and does not reach
    // playback. Space plays and pauses, with the list open too (GitHub #98).
    const thumb = win.locator('.MuiSlider-thumb input');
    await expect(thumb).toHaveValue(String(last));
    await win.getByRole('button', { name: 'Settings' }).click();
    await expect(win.locator('.DraftDrawer')).toBeVisible();
    // One key at a time: the two together would start playback and stop it again. Read once, not
    // with a retrying expect: a retry would wait until the playback it is meant to catch had run to
    // the end and put the slider back where it started.
    const pressAndRead = async (key: string) => {
      await win.keyboard.press(key);
      await win.waitForTimeout(700);
      return [
        await thumb.inputValue(),
        await win.locator('[data-testid="PauseIcon"]').count(),
      ];
    };
    expect(
      await pressAndRead('Enter'),
      'Enter started playback behind the open list'
    ).toEqual([String(last), 0]);
    expect(
      (await pressAndRead('Space'))[1],
      'Space did not play with the list open'
    ).toBe(1);
    await win.keyboard.press('Space');
    await expect(win.locator('[data-testid="PlayArrowIcon"]')).toHaveCount(1);
    // Back to the last frame, where the next step starts from.
    await thumb.press('End');
    await expect(thumb).toHaveValue(String(last));
    await win.keyboard.press('Escape');
    await expect(win.locator('.DraftDrawer')).toBeHidden();
    await expect(win.locator('.ReplayContainer')).toBeVisible();
    await expect(win.locator('.MuiSlider-mark')).toHaveCount(1);

    // 4. A marker made on the Timeline is named there too, and Enter stays on its frame (GitHub #95).
    // Well apart from the first, so neither name covers the other.
    await thumb.press('PageDown');
    await thumb.press('PageDown');
    await thumb.press('PageDown');
    const second = Number(await thumb.inputValue());
    expect(second).toBeLessThan(last - 20);
    await expect(mark).toBeEnabled();
    await mark.click();
    await expect(win.getByLabel('Draft Marker name')).toHaveValue('Draft 2');
    await win.getByLabel('Draft Marker name').press('Enter');
    await expect(win.getByLabel('Draft Marker name')).toHaveCount(0);
    await expect(win.locator('.ReplayContainer')).toBeVisible();
    await expect(thumb).toHaveValue(String(second));
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath).draftMarkers.length === 2,
        10_000
      ),
      'the second marker never reached the file'
    ).toBe(true);
    expect(metaOnDisk(poemPath)).toEqual({
      draftMarkers: [
        { index: last, name: 'zq xv', defaultName: 'Draft 1' },
        { index: second, name: 'Draft 2', defaultName: 'Draft 2' },
      ],
      highestDraftNumber: 2,
    });

    // 5. A click on a name goes to exactly its frame, from wherever the dot is.
    const onTimeline = (name: string) =>
      win.locator('.MuiSlider-markLabel .draft-mark-label', { hasText: name });
    await thumb.press('Home');
    await expect(thumb).toHaveValue('0');
    await onTimeline('zq xv').click();
    await expect(thumb).toHaveValue(String(last));
    await onTimeline('Draft 2').click();
    await expect(thumb).toHaveValue(String(second));

    // 6. A double-click renames in place.
    await onTimeline('Draft 2').dblclick();
    await expect(win.getByLabel('Draft Marker name')).toBeFocused();
    await win.getByLabel('Draft Marker name').fill('qq');
    await win.getByLabel('Draft Marker name').press('Enter');
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath).draftMarkers[1].name === 'qq',
        10_000
      ),
      'the rename on the timeline never reached the file'
    ).toBe(true);

    // 7. Right-click offers Delete: gone from the file at once, and its number is not given out again.
    await onTimeline('zq xv').click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Delete Draft Marker' }).click();
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath).draftMarkers.length === 1,
        10_000
      ),
      'the delete never reached the file'
    ).toBe(true);
    expect(metaOnDisk(poemPath)).toEqual({
      draftMarkers: [{ index: second, name: 'qq', defaultName: 'Draft 2' }],
      highestDraftNumber: 2,
    });
    // No Undo is offered on the timeline (GitHub #98).
    await expect(win.getByRole('button', { name: 'Undo' })).toHaveCount(0);

    // The poem itself is untouched by all of this.
    const saved = JSON.parse(
      readFileSync(poemPath, 'utf8').split('\n').slice(1).join('\n')
    );
    expect(saved.text).toBe(doc.finalHtml);
    expect(saved.history).toHaveLength(doc.history.length);
    expect(failures, failures.join('\n')).toEqual([]);
  } finally {
    await app.close();
  }
});

// GitHub #95, found in review by vivian-1a61bc9a: Escape keeps the name a marker had. The name field is removed as
// Escape is handled, and Chromium blurs a focused element as it goes; that blur must not save what was typed. jsdom
// fires no such blur, so only the real app can show it.
test('Escape on a new marker made while writing keeps its default name, in the file', async () => {
  const doc = makePlayableMidst(LONG);
  const work = mkdtempSync(join(tmpdir(), 'midst-drafts-escape-'));
  const poemPath = join(work, 'escape.midst');
  writeFileSync(poemPath, doc.file);
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the long poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await win.getByRole('button', { name: MARK }).click();
    const nameField = win.getByLabel('Draft Marker name');
    await expect(nameField).toHaveValue('Draft 1', { timeout: 25_000 });
    await nameField.fill('zq xv');
    await nameField.press('Escape');
    await expect(win.locator('.ReplayContainer')).toBeHidden();
    // Long enough for a save that should not happen to reach the file.
    await win.waitForTimeout(2_000);
    expect(metaOnDisk(poemPath).draftMarkers).toEqual([
      { index: doc.history.length - 1, defaultName: 'Draft 1' },
    ]);
  } finally {
    await app.close();
  }
});

// The editor saves a second after the last keystroke. Going to the replay inside that second leaves
// the stored text behind what the replay shows, so a marker on the last moment must take the text and
// history to the file with it, or the file holds a marker that points past its own history.
test('a marker made in the replay straight after typing does not point past the saved history', async () => {
  const doc = makePlayableMidst(LONG);
  const work = mkdtempSync(join(tmpdir(), 'midst-drafts-typed-'));
  const poemPath = join(work, 'typed.midst');
  writeFileSync(poemPath, doc.file);
  const savedDoc = () =>
    JSON.parse(readFileSync(poemPath, 'utf8').split('\n').slice(1).join('\n'));

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the poem to type in');
    const editor = win.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 25_000 });

    await editor.click();
    await win.keyboard.type('zqx');
    await win.getByRole('link', { name: 'Timeline' }).click();
    await expect(win.locator('.ReplayContainer')).toBeVisible({
      timeout: 25_000,
    });
    await win.getByRole('button', { name: MARK }).click();
    await expect(win.getByLabel('Draft Marker name')).toBeVisible();

    expect(
      await waitUntil(
        () => savedDoc().meta?.draftMarkers?.length === 1,
        10_000
      ),
      'the marker never reached the file'
    ).toBe(true);
    const saved = savedDoc();
    // CONTROL: the typing was recorded at all, so the marker is on a moment made after the open.
    expect(saved.meta.draftMarkers[0].index).toBeGreaterThanOrEqual(
      doc.history.length
    );
    expect(
      saved.history.length,
      'the file holds a marker that points past its own history'
    ).toBeGreaterThan(saved.meta.draftMarkers[0].index);
    expect(saved.meta.draftMarkers[0].index).toBe(saved.history.length - 1);
    expect(saved.text).toContain('zqx');
  } finally {
    await app.close();
  }
});

test('a poem with 50 or fewer changes cannot be marked yet', async () => {
  const doc = makePlayableMidst(SHORT);
  expect(doc.history.length).toBeLessThanOrEqual(50);
  const work = mkdtempSync(join(tmpdir(), 'midst-drafts-short-'));
  const poemPath = join(work, 'short.midst');
  writeFileSync(poemPath, doc.file);

  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the short poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    await expect(win.getByRole('button', { name: MARK })).toBeDisabled();
    await win.getByRole('link', { name: 'Timeline' }).click();
    await expect(win.locator('.ReplayContainer')).toBeVisible({
      timeout: 25_000,
    });
    await expect(win.getByRole('button', { name: MARK })).toBeDisabled();
    expect(metaOnDisk(poemPath)).toBeUndefined();
  } finally {
    await app.close();
  }
});

// #313 (GitHub #85): naming a draft must not hide the poem, and the drafts list must cover neither the poem nor the
// timeline. Measured in the real window, at the size it opens at and at a narrow one: the list's box is clear of the
// title bar, the poem and the control bar, nothing is dimmed, and what is under the middle of the poem and the right
// end of the timeline is the replay's own, not the list.
type Box = { x: number; y: number; width: number; height: number };
const right = (b: Box) => b.x + b.width;

async function expectBeside(win: Page) {
  const layout = await win.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const poem = box('.HistoryDisplay');
    const rail = box('.ControlBar .MuiSlider-root');
    const under = (x: number, y: number) =>
      Boolean(document.elementFromPoint(x, y)?.closest('.ReplayMain'));
    return {
      viewport: window.innerWidth,
      bar: box('.cet-titlebar'),
      heading: box('.DraftDrawer h2'),
      panel: box('.DraftDrawer'),
      poem,
      controls: box('.ControlBar'),
      backdrop: document.querySelector('.MuiBackdrop-root') !== null,
      poemShows: under(poem.x + poem.width / 2, poem.y + poem.height / 2),
      railEndShows: under(rail.x + rail.width - 2, rail.y + rail.height / 2),
    };
  });
  const at = `at width ${layout.viewport}`;
  expect(layout.backdrop, `${at}: something is dimmed`).toBe(false);
  expect(
    layout.panel.x,
    `${at}: the list covers the poem`
  ).toBeGreaterThanOrEqual(right(layout.poem) - 0.5);
  expect(
    layout.panel.x,
    `${at}: the list covers the timeline`
  ).toBeGreaterThanOrEqual(right(layout.controls) - 0.5);
  expect(
    right(layout.panel),
    `${at}: the list runs off the window`
  ).toBeLessThanOrEqual(layout.viewport + 0.5);
  expect(
    layout.heading.y,
    `${at}: the title bar covers the list's heading`
  ).toBeGreaterThanOrEqual(layout.bar.y + layout.bar.height - 0.5);
  expect(layout.poemShows, `${at}: the middle of the poem is covered`).toBe(
    true
  );
  expect(layout.railEndShows, `${at}: the end of the timeline is covered`).toBe(
    true
  );
}

test('the drafts list sits beside the poem and the timeline, covering neither', async () => {
  const doc = makePlayableMidst(LONG);
  const work = mkdtempSync(join(tmpdir(), 'midst-drafts-beside-'));
  const poemPath = join(work, 'beside.midst');
  writeFileSync(poemPath, doc.file);
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await openDocument(app, userData, poemPath, 'the long poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    // A marker to list, then Settings opened: a new marker no longer opens it (GitHub #95).
    await win.getByRole('button', { name: MARK }).click();
    await expect(win.getByLabel('Draft Marker name')).toBeVisible({
      timeout: 25_000,
    });
    await win.getByLabel('Draft Marker name').press('Enter');
    await win.getByRole('link', { name: 'Timeline' }).click();
    await win.getByRole('button', { name: 'Settings' }).click();
    await expect(win.locator('.DraftDrawer')).toBeVisible();

    await expectBeside(win);
    await win.screenshot({ path: test.info().outputPath('drafts-beside.png') });

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(900, 600);
    });
    await win.waitForFunction(() => window.innerWidth === 900);
    await expectBeside(win);
    await win.screenshot({
      path: test.info().outputPath('drafts-beside-900.png'),
    });
  } finally {
    await app.close();
  }
});

// GitHub #95, round 2. What Annelyse is troubled by is a name colliding with the timestamp, so these tests look for
// collisions and for names the poet cannot see, in the real window (jsdom has no layout), rather than for positions.
// Each problem found is said in words: which name, and what it is on or under. Each state checked is also kept as a
// screenshot in the test's output folder, for a person to look at. The checks poll: while the timeline
// is still moving a name can pass anywhere, and only what stays is a problem.
async function problems(win: Page): Promise<string[]> {
  return win.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom;
    const bar = document.querySelector('.ControlBar')!;
    const line = box(bar.querySelector('.MuiSlider-rail')!);
    const dot = box(bar.querySelector('.MuiSlider-thumb')!);
    const open = bar.querySelector('.MuiSlider-valueLabelOpen');
    const time = open && box(open);
    const found: string[] = [];
    bar.querySelectorAll('.MuiSlider-markLabel').forEach((name) => {
      const at = box(name);
      const said =
        name.textContent || (name.querySelector('input')?.value ?? '');
      if (overlap(at, line)) found.push(`${said}: on the line`);
      if (overlap(at, dot)) found.push(`${said}: on the dot`);
      if (time && overlap(at, time)) found.push(`${said}: on the timestamp`);
      if (
        at.left < 0 ||
        at.top < 0 ||
        at.right > window.innerWidth ||
        at.bottom > window.innerHeight
      )
        found.push(`${said}: partly outside the window`);
      const seen = document.elementFromPoint(
        (at.left + at.right) / 2,
        (at.top + at.bottom) / 2
      );
      if (!seen || !name.contains(seen))
        found.push(`${said}: under ${seen?.className || 'nothing'}`);
    });
    return found;
  });
}

// Where the line is, how far it is from the middle of its bar, and how much room is left under the lowest thing on
// the timeline.
const lineAndRoom = (win: Page) =>
  win.evaluate(() => {
    const bar = document.querySelector('.ControlBar')!;
    const box = bar.getBoundingClientRect();
    const line = bar.querySelector('.MuiSlider-rail')!.getBoundingClientRect();
    const lowest = Math.max(
      bar.getBoundingClientRect().bottom,
      ...Array.from(bar.querySelectorAll('.MuiSlider-markLabel')).map(
        (n) => n.getBoundingClientRect().bottom
      )
    );
    return {
      line: (line.top + line.bottom) / 2,
      offCentre: Math.abs(
        (line.top + line.bottom) / 2 - (box.top + box.bottom) / 2
      ),
      room: window.innerHeight - lowest,
    };
  });

// Where the dot is drawn along the line: 0 at its start, 1 at its end. MUI slides the dot to a new value over about
// 150ms, so a check made straight after a key can see it where it was (violet-14057653, on #447's screenshot 3).
const dotAlong = (win: Page) =>
  win.evaluate(() => {
    const bar = document.querySelector('.ControlBar')!;
    const line = bar.querySelector('.MuiSlider-rail')!.getBoundingClientRect();
    const dot = bar.querySelector('.MuiSlider-thumb')!.getBoundingClientRect();
    return ((dot.left + dot.right) / 2 - line.left) / line.width;
  });

async function openTimeline(name: string) {
  const doc = makePlayableMidst(LONG);
  const work = mkdtempSync(join(tmpdir(), `midst-drafts-${name}-`));
  const poemPath = join(work, `${name}.midst`);
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
  // The bar grows in as the Timeline opens (MUI Grow): measure once it has (clement-7074f29f, review of #424).
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

// A marker at the frame the slider is on, named.
async function markHere(win: Page, name: string) {
  await win.getByRole('button', { name: MARK }).click();
  const field = win.getByLabel('Draft Marker name');
  await expect(field).toBeVisible({ timeout: 25_000 });
  await field.fill(name);
  await field.press('Enter');
  await expect(win.getByRole('button', { name })).toBeVisible();
}

const showTimestamp = async (win: Page) => {
  await win.getByRole('button', { name: 'Settings' }).click();
  await win.getByRole('checkbox', { name: 'Show timestamp' }).click();
  await win.getByRole('button', { name: 'Settings' }).click();
  await expect(win.locator('.DraftDrawer')).toBeHidden();
};

// Long enough for the timeline's move to finish.
const settled = (win: Page) => win.waitForTimeout(600);

test('round 2: Undo straight after the button takes the new marker back, in the file', async () => {
  const { app, win, poemPath } = await openTimeline('undo');
  const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
  try {
    await win.getByRole('button', { name: MARK }).click();
    const field = win.getByLabel('Draft Marker name');
    await expect(field).toHaveValue('Draft 1', { timeout: 25_000 });
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath)?.draftMarkers?.length === 1,
        10_000
      ),
      'the new marker never reached the file'
    ).toBe(true);
    // Typed in the middle of the field (item 1), on the timestamp's white, not the old yellow (item 1.3).
    const look = await field.evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--midst-surface)';
      document.body.appendChild(probe);
      const surface = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const style = getComputedStyle(el);
      return {
        align: style.textAlign,
        background: style.backgroundColor,
        surface,
      };
    });
    expect(look.align).toBe('center');
    expect(look.background).toBe(look.surface);
    await field.press(undo);
    await expect(field, 'Undo left the name field open').toBeHidden();
    expect(
      await waitUntil(
        () => metaOnDisk(poemPath)?.draftMarkers?.length === 0,
        10_000
      ),
      'Undo did not take the marker out of the file'
    ).toBe(true);
  } finally {
    await app.close();
  }
});

test('round 2: names never collide with the line, the dot or the timestamp, and stay in sight', async () => {
  const { app, win } = await openTimeline('clear');
  try {
    const bare = await lineAndRoom(win);
    // Markers at both ends of the timeline, where a name has least room.
    await markHere(win, 'zq');
    await win.locator('.MuiSlider-thumb input').focus();
    await win.keyboard.press('Home');
    await expect
      .poll(() => dotAlong(win), { message: 'the dot did not go to the start' })
      .toBeLessThan(0.01);
    await markHere(win, 'xv');

    // Item 2: with markers on it, the line stays in the middle of its bar. The whole timeline moves up for the names
    // (option a, #446), so where the line is on the page is not the check; where it is in the bar is.
    await settled(win);
    const marked = await lineAndRoom(win);
    expect(
      bare.offCentre,
      'the line is off centre with no markers'
    ).toBeLessThanOrEqual(0.5);
    expect(
      marked.offCentre,
      'adding a marker took the line off the middle of its bar'
    ).toBeLessThanOrEqual(0.5);
    expect(
      marked.line,
      'the timeline did not move up for the names'
    ).toBeLessThan(bare.line);
    await expect
      .poll(() => problems(win), { message: 'timestamp only on pointing' })
      .toEqual([]);
    await shot(
      app,
      win,
      test.info().outputPath('1-names-below-timestamp-off.png')
    );

    // Item 3: with the timestamp always shown too, names and timestamp keep apart, and the room under the timeline stays.
    await showTimestamp(win);
    await settled(win);
    await expect(win.locator('.MuiSlider-valueLabelOpen')).toBeVisible();
    // The states below are named by where the dot is, so it is checked to be there before anything is judged.
    await expect
      .poll(() => dotAlong(win), { message: 'the dot is not at the start' })
      .toBeLessThan(0.01);
    await expect
      .poll(() => problems(win), { message: 'timestamp shown, dot on xv' })
      .toEqual([]);
    await shot(
      app,
      win,
      test.info().outputPath('2-timestamp-on-dot-at-start.png')
    );
    await win.locator('.MuiSlider-thumb input').focus();
    await win.keyboard.press('End');
    await expect
      .poll(() => dotAlong(win), { message: 'the dot did not go to the end' })
      .toBeGreaterThan(0.99);
    await expect
      .poll(() => problems(win), { message: 'timestamp shown, dot on zq' })
      .toEqual([]);
    await shot(
      app,
      win,
      test.info().outputPath('3-timestamp-on-dot-at-end.png')
    );
    const lifted = await lineAndRoom(win);
    expect(
      lifted.room,
      'the names reach further down than the timeline did'
    ).toBeGreaterThanOrEqual(bare.room - 1);

    // The names gone, the timeline goes back where it was.
    const remove = async (name: string) => {
      await win.getByRole('button', { name }).click({ button: 'right' });
      await win.getByRole('menuitem', { name: 'Delete Draft Marker' }).click();
      await expect(win.getByRole('button', { name })).toHaveCount(0);
    };
    await remove('zq');
    await remove('xv');
    await settled(win);
    const back = await lineAndRoom(win);
    expect(Math.abs(back.line - bare.line)).toBeLessThanOrEqual(0.5);
    expect(back.room).toBeGreaterThanOrEqual(bare.room - 1);
    await shot(
      app,
      win,
      test.info().outputPath('4-deleted-timeline-back-down.png')
    );

    // A narrower, shorter window, with a name at the end of the timeline.
    await markHere(win, 'qz');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(900, 600);
    });
    await win.waitForFunction(() => window.innerWidth === 900);
    await expect
      .poll(() => problems(win), { message: 'at 900 by 600' })
      .toEqual([]);
    await shot(app, win, test.info().outputPath('5-900x600.png'));
  } finally {
    await app.close();
  }
});

// With Show timestamp off (the default), the timestamp still appears while the poet points at or drags the dot. Round 2
// left the names above the line, where it appears, and it landed on them (this test asserted that collision until
// #446). Annelyse chose option (a) on GitHub #95: names below the line whenever there are any, so it never can.
test('option a: with the timestamp off, pointing at the dot on a marker keeps the timestamp off its name', async () => {
  const { app, win } = await openTimeline('pointing');
  try {
    const bare = await lineAndRoom(win);
    await markHere(win, 'zq');
    await win.locator('.MuiSlider-thumb').hover();
    // The control: the timestamp is open, so there is something to collide with.
    await expect(win.locator('.MuiSlider-valueLabelOpen')).toBeVisible();
    await expect
      .poll(() => problems(win), { message: 'pointing at the dot on zq' })
      .toEqual([]);
    await shot(
      app,
      win,
      test.info().outputPath('6-pointing-timestamp-off.png')
    );
    // The timeline moved up for the name, so the room under it stays.
    const marked = await lineAndRoom(win);
    expect(marked.room).toBeGreaterThanOrEqual(bare.room - 1);
  } finally {
    await app.close();
  }
});
