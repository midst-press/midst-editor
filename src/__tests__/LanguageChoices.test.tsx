import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import LanguageChoices from '../renderer/language/LanguageChoices';
import { LocaleContext } from '../renderer/locale';

// The languages on the opening screen (editor #265): visible with nothing to open, English with the American flag,
// the language shown pressed, and a click asking the main process to change it.
let sent: unknown[][];
let order: string[];

beforeEach(() => {
  sent = [];
  order = ['en', 'de'];
  (window as unknown as { electron: unknown }).electron = {
    languageOrder: () => order,
    ipcRenderer: {
      sendMessage: (channel: string, args: unknown[]) =>
        sent.push([channel, ...args]),
    },
  };
});

const show = (locale = 'en') =>
  render(
    <LocaleContext.Provider value={locale}>
      <LanguageChoices />
    </LocaleContext.Provider>
  );

it("lists each language as a button, by its own name, in the main process's order", () => {
  show();
  const group = screen.getByRole('group', { name: 'Language' });
  const buttons = [...group.querySelectorAll('button')];
  expect(buttons.map((b) => [b.textContent, b.getAttribute('lang')])).toEqual([
    ['English', 'en'],
    ['Deutsch', 'de'],
  ]);
});

it('puts the American flag beside English only, hidden from a screen reader', () => {
  show();
  const english = screen.getByRole('button', { name: 'English' });
  const flag = english.querySelector('svg.language-flag');
  expect(flag).not.toBeNull();
  expect(flag).toHaveAttribute('aria-hidden', 'true');
  expect(
    screen.getByRole('button', { name: 'Deutsch' }).querySelector('svg')
  ).toBeNull();
});

it('shows the language in use as pressed', () => {
  show('de');
  expect(screen.getByRole('button', { name: 'Deutsch' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
});

it('asks the main process for the language chosen', () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Deutsch' }));
  expect(sent).toEqual([['set-language', 'de']]);
});
