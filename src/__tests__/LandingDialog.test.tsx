import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LandingDialog from '../renderer/components/LandingDialog';
import { HistoryContext, TextContext } from '../renderer/context';
import { i18n } from '../shared/i18n';

// #210: each button on the opening screen asks the main process for exactly one thing, on its own channel.
const sendMessage = jest.fn();
beforeEach(() => {
  sendMessage.mockReset();
  (window as unknown as { electron: unknown }).electron = {
    versions: { isMac: false },
    store: { get: () => undefined, set: () => undefined },
    titlebar: { updateTitle: () => undefined },
    ipcRenderer: { sendMessage, on: () => () => undefined },
  };
  render(
    <MemoryRouter>
      <TextContext.Provider value={{ text: '', setText: jest.fn() }}>
        <HistoryContext.Provider
          value={{ poemHistory: [], setPoemHistory: jest.fn() }}
        >
          <LandingDialog />
        </HistoryContext.Provider>
      </TextContext.Provider>
    </MemoryRouter>
  );
});

describe('the opening screen’s buttons', () => {
  it.each([
    ['landing.newFile', 'new-file'],
    ['landing.openFile', 'button-open-file'],
    ['landing.needHelp', 'open-help'],
  ])('%s sends %s, once, and nothing else', (label, channel) => {
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: i18n._(label) }));
    expect(sendMessage.mock.calls).toEqual([[channel, []]]);
  });
});
