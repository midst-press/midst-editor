import { useContext } from 'react';
import { i18n, languageName, SOURCE_LOCALE } from '../../shared/i18n';
import { LocaleContext } from '../locale';
import UsFlag from './UsFlag';
import './LanguageChoices.css';

// The languages, shown on the opening screen with nothing to open first (Stuart, 20 Oct, editor #265). The order is
// the main process's (English, the system's own language, the rest), the same as View > Language. Choosing one
// asks the main process, which stores it, rebuilds the menus and tells the window ('set-locale').
export default function LanguageChoices() {
  const locale = useContext(LocaleContext);
  return (
    <div
      className="language-choices"
      role="group"
      aria-label={i18n._('landing.language')}
    >
      {window.electron.languageOrder().map((tag) => (
        <button
          key={tag}
          type="button"
          lang={tag}
          aria-pressed={tag === locale}
          onClick={() =>
            window.electron.ipcRenderer.sendMessage('set-language', [tag])
          }
        >
          {tag === SOURCE_LOCALE ? <UsFlag /> : null}
          {languageName(tag)}
        </button>
      ))}
    </div>
  );
}
