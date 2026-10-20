import {
  i18n,
  activateLocale,
  catalogs,
  chosenLocale,
  languageName,
  languageOrder,
  readerLocale,
  SOURCE_LOCALE,
} from '../shared/i18n';
import linguiConfig from '../../lingui.config';

describe('chosenLocale', () => {
  const available = ['en', 'fr', 'pt-BR'];

  it('is English until the poet chooses, whatever the system language', () => {
    expect(chosenLocale(undefined, available)).toBe('en');
  });

  it('is the stored choice while it has a catalog', () => {
    expect(chosenLocale('fr', available)).toBe('fr');
    expect(chosenLocale('pt-BR', available)).toBe('pt-BR');
  });

  it('is English for a stored choice with no catalog, or not a tag at all', () => {
    expect(chosenLocale('de', available)).toBe('en');
    expect(chosenLocale('FR', available)).toBe('en');
    expect(chosenLocale('toString', available)).toBe('en');
    expect(chosenLocale(3, available)).toBe('en');
    expect(chosenLocale('', available)).toBe('en');
  });

  it('reads the compiled catalogs by default', () => {
    expect(chosenLocale('en')).toBe('en');
    expect(chosenLocale('xx')).toBe('en');
  });
});

describe('readerLocale', () => {
  const available = ['en', 'fr', 'pt-BR'];

  it('takes the first preference the catalog has', () => {
    expect(readerLocale(['de', 'fr', 'en'], available)).toBe('fr');
  });

  it('matches a regional tag by its language', () => {
    expect(readerLocale(['fr-CA'], available)).toBe('fr');
  });

  it('prefers an exact regional match, ignoring case', () => {
    expect(readerLocale(['PT-br'], available)).toBe('pt-BR');
  });

  it('is undefined when nothing matches, or there are no preferences', () => {
    expect(readerLocale(['de', 'ja'], available)).toBeUndefined();
    expect(readerLocale([], available)).toBeUndefined();
  });
});

describe('languageOrder', () => {
  const available = ['pt-BR', 'en', 'fr', 'de'];

  it("puts English first, then the poet's own language, then the rest by tag", () => {
    expect(languageOrder(['fr-CA', 'en'], available)).toEqual([
      'en',
      'fr',
      'de',
      'pt-BR',
    ]);
  });

  it("puts English first once when English is the poet's own language", () => {
    expect(languageOrder(['en-NZ', 'fr'], available)).toEqual([
      'en',
      'de',
      'fr',
      'pt-BR',
    ]);
  });

  it('is English then the rest when no preference has a catalog', () => {
    expect(languageOrder(['ja'], available)).toEqual([
      'en',
      'de',
      'fr',
      'pt-BR',
    ]);
  });

  it('is only English with only the English catalog', () => {
    expect(languageOrder(['fr', 'en'])).toEqual(['en']);
  });
});

describe('languageName', () => {
  it('names a language in that language', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('de')).toBe('Deutsch');
  });

  it('is the tag when the runtime names nothing for it', () => {
    const spy = jest
      .spyOn(Intl, 'DisplayNames')
      .mockImplementation(
        () => ({ of: () => undefined } as unknown as Intl.DisplayNames)
      );
    try {
      expect(languageName('zq')).toBe('zq');
    } finally {
      spy.mockRestore();
    }
  });

  it('is the tag when it cannot name it', () => {
    expect(languageName('not a tag')).toBe('not a tag');
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
