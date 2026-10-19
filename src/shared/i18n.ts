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

/**
 * The catalog language to show for `preferred`, the system's languages in order of preference
 * (Electron's `app.getPreferredSystemLanguages()`). A tag matches exactly, ignoring case, or by its
 * language alone (`fr-CA` matches `fr`). The first preference with a match wins; with none, English.
 */
export function pickLocale(
  preferred: readonly string[],
  available: readonly string[] = Object.keys(catalogs)
): string {
  const byLower = new Map(available.map((tag) => [tag.toLowerCase(), tag]));
  const match = (tag: string) => {
    const lower = tag.toLowerCase();
    return byLower.get(lower) ?? byLower.get(lower.split('-')[0]);
  };
  const found = preferred.find((tag) => match(tag) !== undefined);
  return found === undefined ? SOURCE_LOCALE : (match(found) as string);
}

/** Load and activate `locale`'s catalog, English for a locale with none. Returns the locale used. */
export function activateLocale(locale: string): string {
  // Own keys only, so 'toString' and the like are not taken for a catalog (lib is es2021: no Object.hasOwn).
  const used = Object.prototype.hasOwnProperty.call(catalogs, locale)
    ? locale
    : SOURCE_LOCALE;
  i18n.loadAndActivate({ locale: used, messages: catalogs[used] });
  return used;
}

// English from the first import, so a word looked up before the main process has chosen a language
// (an early error dialog, a test) is English and never the bare id.
activateLocale(SOURCE_LOCALE);

export { i18n };
