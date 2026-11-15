// Keystrokes a test needs Windows' spellchecker to see (editor #510). On Windows they go through the OS, as real
// keystrokes (sendinput.ps1, user32 SendInput): Windows' checker in Electron does not mark words typed through
// Playwright's DevTools-protocol keys, in a desktop session or over ssh, and marks the same words typed at the
// keyboard (Stuart, by hand, 15 Nov). Elsewhere they go through Playwright, as they always have.

import type { ElectronApplication, Page } from 'playwright';
import { execFileSync } from 'child_process';
import { join } from 'path';

export type OsKey = string | 'Enter' | 'ArrowUp' | 'End';

// A poet's pace between keystrokes, in ms.
export const POET_MS = 120;

/** Type `keys` into Midst's window: "Enter", "ArrowUp" and "End" are keys, anything else is text. */
export async function osType(
  app: ElectronApplication,
  win: Page,
  keys: OsKey[],
  pace = 0
): Promise<void> {
  if (process.platform !== 'win32') {
    await keys.reduce(async (sofar, k) => {
      await sofar;
      if (k === 'Enter' || k === 'ArrowUp' || k === 'End')
        await win.keyboard.press(k);
      else await win.keyboard.type(k, { delay: pace });
    }, Promise.resolve());
    return;
  }
  // The window's own handle, so the helper types into nothing else.
  const hwnd = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.show();
    w.focus();
    return w.getNativeWindowHandle().readBigUInt64LE(0).toString();
  });
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(__dirname, 'sendinput.ps1'),
      '-Hwnd',
      hwnd,
      '-Keys',
      Buffer.from(JSON.stringify(keys), 'utf8').toString('base64'),
      '-PaceMs',
      String(Math.max(pace, 30)),
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
}
