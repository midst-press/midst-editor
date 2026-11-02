/** @jest-environment node */
import type { BrowserWindow } from 'electron';
import sendToWindow from '../main/sendToWindow';

// The channel maps are types (#355): what they promise is that a wrong channel or payload does not
// compile. Each @ts-expect-error below fails the type check if that line ever compiles.

const fakeWindow = () => {
  const send = jest.fn();
  return { win: { webContents: { send } } as unknown as BrowserWindow, send };
};

describe('sendToWindow', () => {
  it('sends the channel and its payload, spread, as webContents.send does', () => {
    const { win, send } = fakeWindow();
    sendToWindow(win, 'open-file', '<p>zq</p>', [], 'zq.midst');
    sendToWindow(win, 'set-not-saved', true);
    sendToWindow(win, 'find-in-poem');
    expect(send.mock.calls).toEqual([
      ['open-file', '<p>zq</p>', [], 'zq.midst'],
      ['set-not-saved', true],
      ['find-in-poem'],
    ]);
  });

  it('refuses, at compile time, a channel the window does not listen on or a payload of the wrong shape', () => {
    const { win } = fakeWindow();
    const typeOnly = () => {
      // @ts-expect-error not a channel
      sendToWindow(win, 'zq-not-a-channel');
      // @ts-expect-error the window sends this one, main does not
      sendToWindow(win, 'save-file');
      // @ts-expect-error set-not-saved carries a boolean
      sendToWindow(win, 'set-not-saved', 'true');
      // @ts-expect-error open-file carries three values
      sendToWindow(win, 'open-file', '<p>zq</p>');
    };
    expect(typeof typeOnly).toBe('function');
  });
});
