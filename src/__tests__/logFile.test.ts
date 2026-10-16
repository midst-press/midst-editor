/** @jest-environment node */
import { logFileForPeople, logFilePath } from '../main/logFile';

jest.mock('electron-log', () => ({
  __esModule: true,
  default: {
    transports: {
      file: {
        getFile: () => ({ path: '/Users/zq/Library/Logs/Midst/main.log' }),
      },
    },
  },
}));

describe('where the log is', () => {
  it('is the path electron-log writes to', () => {
    expect(logFilePath()).toBe('/Users/zq/Library/Logs/Midst/main.log');
  });

  it('is told with the home folder as ~ on macOS and Linux', () => {
    expect(
      logFileForPeople(
        '/Users/zq/Library/Logs/Midst/main.log',
        '/Users/zq',
        'darwin'
      )
    ).toBe('~/Library/Logs/Midst/main.log');
    expect(
      logFileForPeople(
        '/home/zq/.config/Midst/logs/main.log',
        '/home/zq',
        'linux'
      )
    ).toBe('~/.config/Midst/logs/main.log');
  });

  it('is told in full on Windows, where ~ means nothing to a poet', () => {
    const path = 'C:\\Users\\zq\\AppData\\Roaming\\Midst\\logs\\main.log';
    expect(logFileForPeople(path, 'C:\\Users\\zq', 'win32')).toBe(path);
  });

  it('is told in full outside the home folder, or in a folder that only starts with its name', () => {
    expect(
      logFileForPeople('/var/log/midst/main.log', '/Users/zq', 'darwin')
    ).toBe('/var/log/midst/main.log');
    expect(logFileForPeople('/Users/zq2/main.log', '/Users/zq', 'darwin')).toBe(
      '/Users/zq2/main.log'
    );
    expect(logFileForPeople('/Users/zq/main.log', '', 'darwin')).toBe(
      '/Users/zq/main.log'
    );
  });

  it('defaults to the real log path', () => {
    expect(logFileForPeople()).toMatch(/main\.log$/);
  });
});
