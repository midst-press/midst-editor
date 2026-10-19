// Draft markers: a poet marks a state of the poem as a named draft (midst-format docs/META.md).
//
// A marker is `{ index, name, defaultName }` in `meta.draftMarkers`. `index` is a 0-based position in
// `history`. `meta.highestDraftNumber` counts the drafts ever made, so the next default name is
// "Draft <n + 1>" and a deleted draft's number is never given out again, as in the original app.
//
// These functions take a document's `meta` and return a new one. They never change the object they
// are given, and they keep everything they do not understand: unknown keys of `meta`, extra keys of a
// marker (converted files carry `description` and `timestamp`), markers that point outside the
// history, and array entries that are not markers at all. A save must not delete what a poet made.
//
// Marker names are poem data: never log or print them.

export type Meta = Record<string, unknown>;

export interface DraftMarker {
  index: number;
  name?: string;
  defaultName?: string;
  [key: string]: unknown;
}

export type MarkerRefusal =
  | 'not-a-history-position' // index is not a whole number inside the history
  | 'position-has-a-marker' // one draft marker per position
  | 'no-draft-number-left' // the counter is at the largest number that can be counted exactly
  | 'no-marker-there'
  | 'markers-unreadable'; // meta.draftMarkers exists and is not a list: left alone

export type MarkerResult =
  | { ok: true; meta: Meta }
  | { ok: false; reason: MarkerRefusal };

const DEFAULT_NAME = /^Draft (\d+)$/;

const isMarker = (entry: unknown): entry is DraftMarker =>
  typeof entry === 'object' &&
  entry !== null &&
  Number.isSafeInteger((entry as DraftMarker).index);

// The stored list as it is, or null when the key holds something that is not a list.
const storedList = (meta: Meta): unknown[] | null => {
  if (meta.draftMarkers === undefined) return [];
  return Array.isArray(meta.draftMarkers) ? meta.draftMarkers : null;
};

// The highest draft number ever given out. The stored counter is trusted only upward: a file whose
// counter is missing, damaged or behind its own default names still never repeats a number.
const highestNumber = (meta: Meta, list: unknown[]) => {
  const stored = meta.highestDraftNumber;
  let highest =
    Number.isSafeInteger(stored) && (stored as number) > 0
      ? (stored as number)
      : 0;
  list.forEach((entry) => {
    if (!isMarker(entry) || typeof entry.defaultName !== 'string') return;
    const numbered = DEFAULT_NAME.exec(entry.defaultName);
    const number = numbered ? Number(numbered[1]) : 0;
    // A number too large to count exactly is ignored, as a damaged counter is.
    if (Number.isSafeInteger(number)) highest = Math.max(highest, number);
  });
  return highest;
};

const positionOf = (list: unknown[], index: number) =>
  list.findIndex((entry) => isMarker(entry) && entry.index === index);

// A new marker at `index`, with the next default name and no name of its own yet.
export const createMarker = (
  meta: Meta,
  index: number,
  historyLength: number
): MarkerResult => {
  const list = storedList(meta);
  if (list === null) return { ok: false, reason: 'markers-unreadable' };
  // The length is checked as the index is: a comparison with a missing or broken length is false.
  if (
    !Number.isSafeInteger(historyLength) ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= historyLength
  )
    return { ok: false, reason: 'not-a-history-position' };
  if (positionOf(list, index) !== -1)
    return { ok: false, reason: 'position-has-a-marker' };
  const number = highestNumber(meta, list) + 1;
  if (!Number.isSafeInteger(number))
    return { ok: false, reason: 'no-draft-number-left' };
  // Stored in the poem, so it is the poem's data, not the app's words: it stays as it is until the design
  // decides how a stored name is shown in another language (message-catalog.md, section 9, PR 9).
  // eslint-disable-next-line lingui/no-unlocalized-strings
  const marker: DraftMarker = { index, defaultName: `Draft ${number}` };
  return {
    ok: true,
    meta: {
      ...meta,
      draftMarkers: [...list, marker],
      highestDraftNumber: number,
    },
  };
};

// Names the marker at `index`. A name that is empty or only spaces puts the default name back, as
// the original app did. Any other name is kept exactly as typed.
export const renameMarker = (
  meta: Meta,
  index: number,
  name: string
): MarkerResult => {
  const list = storedList(meta);
  if (list === null) return { ok: false, reason: 'markers-unreadable' };
  const at = positionOf(list, index);
  if (at === -1) return { ok: false, reason: 'no-marker-there' };
  const marker = list[at] as DraftMarker;
  const renamed: DraftMarker = { ...marker };
  if (name.trim() !== '') renamed.name = name;
  else if (typeof marker.defaultName === 'string')
    renamed.name = marker.defaultName;
  else delete renamed.name;
  return {
    ok: true,
    meta: {
      ...meta,
      draftMarkers: [...list.slice(0, at), renamed, ...list.slice(at + 1)],
    },
  };
};

// Removes the marker at `index`. The counter is written, never lowered, so the number is not reused.
export const deleteMarker = (meta: Meta, index: number): MarkerResult => {
  const list = storedList(meta);
  if (list === null) return { ok: false, reason: 'markers-unreadable' };
  const at = positionOf(list, index);
  if (at === -1) return { ok: false, reason: 'no-marker-there' };
  return {
    ok: true,
    meta: {
      ...meta,
      draftMarkers: [...list.slice(0, at), ...list.slice(at + 1)],
      highestDraftNumber: highestNumber(meta, list),
    },
  };
};

export interface ShownMarker {
  index: number;
  label: string;
}

// The markers to show for a history of this length, in the file's order: those that point inside it.
// The label is the poet's name, else the default name, else "Draft", as the web player shows them.
export const shownMarkers = (
  meta: Meta,
  historyLength: number
): ShownMarker[] => {
  const list = storedList(meta) ?? [];
  const text = (value: unknown) =>
    typeof value === 'string' && value !== '' ? value : undefined;
  return list
    .filter(isMarker)
    .filter(({ index }) => index >= 0 && index < historyLength)
    .map(({ index, name, defaultName }) => ({
      index,
      // The same as the stored default name, so with it until PR 9.
      // eslint-disable-next-line lingui/no-unlocalized-strings
      label: text(name) ?? text(defaultName) ?? 'Draft',
    }));
};
