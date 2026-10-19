import { LOCALE_ARGUMENT, localeFromArgv } from '../shared/localeArgument';

// src/shared/localeArgument.ts: how the renderer learns the language the main process chose.

describe('localeFromArgv', () => {
  it('reads the locale the argument names, wherever it is on the command line', () => {
    expect(
      localeFromArgv(['electron', `${LOCALE_ARGUMENT}fr-CA`, '--other'])
    ).toBe('fr-CA');
  });

  it('is English when no argument names a locale, or the one there is empty', () => {
    expect(localeFromArgv(['electron', '--other'])).toBe('en');
    expect(localeFromArgv([])).toBe('en');
    expect(localeFromArgv([LOCALE_ARGUMENT])).toBe('en');
  });

  it('takes the first when there are two', () => {
    expect(
      localeFromArgv([`${LOCALE_ARGUMENT}fr`, `${LOCALE_ARGUMENT}de`])
    ).toBe('fr');
  });

  it('does not take an argument that only begins the same way', () => {
    expect(localeFromArgv(['--midst-localefr', '--midst-locale'])).toBe('en');
  });
});
