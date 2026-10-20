import { i18n, type Messages } from '@lingui/core';
import { messages as en } from '../../locales/en/messages';

// The message catalog (midst-infra docs/design/message-catalog.md). The main process and the
// renderer both read the words from here, by id, through the same `i18n` instance's API.
//
// The catalogs are compiled from locales/<lang>/messages.po by `npm run catalog:compile`. A
// language added to lingui.config.js is added here too; the catalog check fails until it is.

export const SOURCE_LOCALE = 'en';

/** Every compiled catalog, by BCP 47 tag. English is complete; another language may be partial,
 *  and a key it lacks was compiled to the English. */
export const catalogs: Readonly<Record<string, Messages>> = { en };

/** True when `tag` is one of `available`, exactly. A list of tags, so 'toString' and the like are never
 *  taken for a catalog. */
const hasCatalog = (tag: string, available: readonly string[]): boolean =>
  available.includes(tag);

/**
 * The language the app shows: the one the poet chose from the Language menu, kept in the store, while
 * it still has a catalog. Otherwise English, whatever the system's language (Stuart, 20 Oct, editor
 * #265: the app starts in English until the poet chooses).
 */
export function chosenLocale(
  stored: unknown,
  available: readonly string[] = Object.keys(catalogs)
): string {
  return typeof stored === 'string' && hasCatalog(stored, available)
    ? stored
    : SOURCE_LOCALE;
}

/**
 * The poet's own language among the catalogs: the first of `preferred`, the system's languages in order
 * of preference (Electron's `app.getPreferredSystemLanguages()`, never a guess from location), that has
 * one. A tag matches exactly, ignoring case, or by its language alone (`fr-CA` matches `fr`). None
 * matching gives undefined.
 */
export function readerLocale(
  preferred: readonly string[],
  available: readonly string[] = Object.keys(catalogs)
): string | undefined {
  const byLower = new Map(available.map((tag) => [tag.toLowerCase(), tag]));
  const match = (tag: string) => {
    const lower = tag.toLowerCase();
    return byLower.get(lower) ?? byLower.get(lower.split('-')[0]);
  };
  const found = preferred.find((tag) => match(tag) !== undefined);
  return found === undefined ? undefined : match(found);
}

/**
 * The Language menu's order: English first, then the poet's own language when it is another catalog,
 * then the rest by tag.
 */
export function languageOrder(
  preferred: readonly string[],
  available: readonly string[] = Object.keys(catalogs)
): string[] {
  const own = readerLocale(preferred, available);
  const first =
    own === undefined || own === SOURCE_LOCALE
      ? [SOURCE_LOCALE]
      : [SOURCE_LOCALE, own];
  const rest = available.filter((tag) => !first.includes(tag)).sort();
  return [...first, ...rest];
}

/** A language's name in that language ("Deutsch" for de), or the tag when the runtime has no name for it. */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Load and activate `locale`'s catalog, English for a locale with none. Returns the locale used. */
export function activateLocale(locale: string): string {
  const used = hasCatalog(locale, Object.keys(catalogs))
    ? locale
    : SOURCE_LOCALE;
  i18n.loadAndActivate({ locale: used, messages: catalogs[used] });
  return used;
}

// English from the first import, so a word looked up before the main process has chosen a language
// (an early error dialog, a test) is English and never the bare id.
activateLocale(SOURCE_LOCALE);

export { i18n };
