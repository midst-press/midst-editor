// How the main process tells the renderer which language it chose (midst-infra docs/design/message-catalog.md,
// section 6): one argument on the renderer's command line (webPreferences.additionalArguments), read by the
// preload, which hands it to the renderer. The renderer then activates the same catalog. Its own module, with no
// imports, so the preload does not bundle the catalogs to read one argument.

export const LOCALE_ARGUMENT = '--midst-locale=';

/** The locale `argv` names with LOCALE_ARGUMENT, or English when it names none or an empty one. */
export function localeFromArgv(argv: readonly string[]): string {
  const arg = argv.find((a) => a.startsWith(LOCALE_ARGUMENT));
  return arg?.slice(LOCALE_ARGUMENT.length) || 'en';
}
