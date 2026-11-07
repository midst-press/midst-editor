// Draft markers: a poet marks a state of the poem as a named draft (midst-format docs/META.md).
//
// A marker is `{ index, name, defaultName }` in `meta.draftMarkers`. `index` is a 0-based position in
// `history`.
//
// Default names follow the Timeline (Annelyse, GitHub #117, option a; editor #457): the drafts that have no name of
// their own are Draft 1, Draft 2, ... in their order on the Timeline, whatever order they were made in. A draft with a
// name of its own keeps it and takes no number, so the numbers run on past it. Every change renumbers them, so a
// number can be given again after a delete. The original app never gave a number twice; she chose this instead.
// `meta.highestDraftNumber` is written as the number of drafts with a default name, so "Draft <n + 1>" is still the
// name the next one at the end of the Timeline would get (midst-format docs/META.md).
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
  | 'no-marker-there'
  | 'markers-unreadable'; // meta.draftMarkers exists and is not a list: left alone

export type MarkerResult =
  { ok: true; meta: Meta } | { ok: false; reason: MarkerRefusal };

const isMarker = (entry: unknown): entry is DraftMarker =>
  typeof entry === 'object' &&
  entry !== null &&
  Number.isSafeInteger((entry as DraftMarker).index);

// The stored list as it is, or null when the key holds something that is not a list.
const storedList = (meta: Meta): unknown[] | null => {
  if (meta.draftMarkers === undefined) return [];
  return Array.isArray(meta.draftMarkers) ? meta.draftMarkers : null;
};

// A marker shows its default name when it has no name of its own. An empty rename stores the default name as its name,
// as the original app did, so a name that is its default name is one too.
const hasDefaultName = (marker: DraftMarker) =>
  typeof marker.name !== 'string' ||
  marker.name.trim() === '' ||
  marker.name === marker.defaultName;

// The list with its default names numbered in Timeline order (two markers at one position in the order of the list),
// and how many there are. Everything else in it is kept as it is, and an entry whose name does not change is the same
// object, so a list that needs no renumbering comes back equal.
const renumbered = (list: unknown[]): { list: unknown[]; count: number } => {
  const numbered = list
    .map((entry, at) => ({ entry, at }))
    .filter(
      ({ entry }) => isMarker(entry) && hasDefaultName(entry as DraftMarker)
    )
    .sort(
      (a, b) =>
        (a.entry as DraftMarker).index - (b.entry as DraftMarker).index ||
        a.at - b.at
    );
  const numberAt = new Map(numbered.map(({ at }, i) => [at, i + 1]));
  return {
    count: numbered.length,
    list: list.map((entry, at) => {
      const number = numberAt.get(at);
      if (number === undefined) return entry;
      const marker = entry as DraftMarker;
      // Stored in the poem, so it is the poem's data, not the app's words: it stays as it is until the design
      // decides how a stored name is shown in another language (message-catalog.md, section 9, PR 9).
      // eslint-disable-next-line lingui/no-unlocalized-strings
      const defaultName = `Draft ${number}`;
      if (marker.defaultName === defaultName) return entry;
      const next: DraftMarker = { ...marker, defaultName };
      // A name that was its default name follows it, so it is not left behind as a name of its own.
      if (typeof marker.name === 'string' && marker.name === marker.defaultName)
        next.name = defaultName;
      return next;
    }),
  };
};

// The meta with `list` as its markers, renumbered.
const withMarkers = (meta: Meta, list: unknown[]): Meta => {
  const { list: draftMarkers, count } = renumbered(list);
  return { ...meta, draftMarkers, highestDraftNumber: count };
};

const positionOf = (list: unknown[], index: number) =>
  list.findIndex((entry) => isMarker(entry) && entry.index === index);

// A new marker at `index`, with no name of its own yet: its default name is its place among the default names.
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
  const marker: DraftMarker = { index };
  return { ok: true, meta: withMarkers(meta, [...list, marker]) };
};

// Names the marker at `index`. A name that is empty or only spaces puts the default name back, as
// the original app did, and the marker is numbered again. Any other name is kept exactly as typed.
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
    meta: withMarkers(meta, [
      ...list.slice(0, at),
      renamed,
      ...list.slice(at + 1),
    ]),
  };
};

// Removes the marker at `index`. The default names after it move down to close the gap.
export const deleteMarker = (meta: Meta, index: number): MarkerResult => {
  const list = storedList(meta);
  if (list === null) return { ok: false, reason: 'markers-unreadable' };
  const at = positionOf(list, index);
  if (at === -1) return { ok: false, reason: 'no-marker-there' };
  return {
    ok: true,
    meta: withMarkers(meta, [...list.slice(0, at), ...list.slice(at + 1)]),
  };
};

// The marker at `index` and where it sits in the stored list, so a delete can be undone with the marker exactly as
// it was (its own name, default name and any keys this app does not know). Null when there is none.
export const markerAt = (
  meta: Meta,
  index: number
): { marker: DraftMarker; position: number } | null => {
  const list = storedList(meta);
  if (list === null) return null;
  const position = positionOf(list, index);
  return position === -1
    ? null
    : { marker: list[position] as DraftMarker, position };
};

// Puts back a deleted marker (#277), at its old place in the list, or at the end when the list has since become
// shorter, with everything of its own. A default name is numbered again for where it is on the Timeline. Refused when
// another marker now holds its position.
export const restoreMarker = (
  meta: Meta,
  marker: DraftMarker,
  position: number
): MarkerResult => {
  const list = storedList(meta);
  if (list === null) return { ok: false, reason: 'markers-unreadable' };
  if (positionOf(list, marker.index) !== -1)
    return { ok: false, reason: 'position-has-a-marker' };
  const at = Math.min(Math.max(position, 0), list.length);
  const restored = [...list.slice(0, at), marker, ...list.slice(at)];
  return { ok: true, meta: withMarkers(meta, restored) };
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
