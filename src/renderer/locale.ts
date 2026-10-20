import { createContext, useEffect, useState } from 'react';
import { activateLocale, i18n } from '../shared/i18n';

// The language the window's words are in (editor #265). The main process chooses it, at launch through the
// window's arguments (index.tsx) and from View > Language through 'set-locale'. App holds it as state, so a
// change re-renders the window in the new language in place, with the poem and its history untouched.
// A word computed in a useMemo lists the locale from LocaleContext among its dependencies.
export const LocaleContext = createContext<string>(i18n.locale);

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
