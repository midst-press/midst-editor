import {
  i18n,
  activateLocale,
  catalogs,
  pickLocale,
  SOURCE_LOCALE,
} from '../shared/i18n';
import linguiConfig from '../../lingui.config';

describe('pickLocale', () => {
  const available = ['en', 'fr', 'pt-BR'];

  it('takes the first preference the catalog has', () => {
    expect(pickLocale(['de', 'fr', 'en'], available)).toBe('fr');
  });

  it('matches a regional tag by its language', () => {
    expect(pickLocale(['fr-CA'], available)).toBe('fr');
  });

  it('prefers an exact regional match, ignoring case', () => {
    expect(pickLocale(['PT-br'], available)).toBe('pt-BR');
  });

  it('falls back to English when nothing matches, or there are no preferences', () => {
    expect(pickLocale(['de', 'ja'], available)).toBe('en');
    expect(pickLocale([], available)).toBe('en');
  });

  it('reads the compiled catalogs by default', () => {
    expect(pickLocale(['en-NZ'])).toBe('en');
  });
});

describe('on import', () => {
  it('has English active, so a word is English and never its bare id', () => {
    expect(i18n.locale).toBe('en');
    expect(i18n._('button.ok')).toBe('OK');
  });
});

describe('activateLocale', () => {
  it('activates a catalog the app has', () => {
    expect(activateLocale('en')).toBe('en');
    expect(i18n.locale).toBe('en');
  });

  it('uses English for a locale with no catalog, including an Object.prototype name', () => {
    expect(activateLocale('xx')).toBe('en');
    expect(activateLocale('toString')).toBe('en');
    expect(i18n.locale).toBe('en');
  });
});

describe('catalogs', () => {
  it('has exactly the locales lingui.config.js lists, with English as the source', () => {
    expect(Object.keys(catalogs).sort()).toEqual(
      [...linguiConfig.locales].sort()
    );
    expect(linguiConfig.sourceLocale).toBe(SOURCE_LOCALE);
  });
});
