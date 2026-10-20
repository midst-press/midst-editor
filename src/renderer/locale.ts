import { createContext, useEffect, useState } from 'react';
import { activateLocale, chosenLocale, i18n } from '../shared/i18n';

// The language the window's words are in (editor #265): the poet's choice, kept in the store, else English. The
// window reads it from the store when it starts (startingLocale), so a reload after View > Language starts in the
// new language, and the main process sends 'set-locale' when the poet chooses. App holds it as state, so a
// change re-renders the window in the new language in place, with the poem and its history untouched.
// A word computed in a useMemo lists the locale from LocaleContext among its dependencies.
export const LocaleContext = createContext<string>(i18n.locale);

/** Activate the language the window starts in, by the main process's own rule (chosenLocale). */
export function startingLocale(): string {
  return activateLocale(chosenLocale(window.electron?.store.get('language')));
}

export function useMenuLocale(): string {
  const [locale, setLocale] = useState(() => i18n.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(
    () =>
      window.electron?.ipcRenderer.on('set-locale', (next) =>
        setLocale(activateLocale(String(next)))
      ),
    []
  );

  return locale;
}
