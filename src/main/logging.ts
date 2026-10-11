import log from 'electron-log';
import { join } from 'path';
import store from './store';

// Centralised logging, with a level the user can change so a problem can be reproduced at higher
// verbosity and the file sent in. electron-log was already a dependency and already wired to
// electron-updater; it was doing nothing else, while diagnostics went to bare console calls that
// nobody running an installer ever sees.
//
// Where the file goes (electron-log v4 defaults):
//   macOS    ~/Library/Logs/<app>/main.log
//   Windows  %USERPROFILE%\AppData\Roaming\<app>\logs\main.log
//   Linux    ~/.config/<app>/logs/main.log

// MIDST_LOG_DIR moves the log file. The end-to-end specs set it to their own temporary directory, so a
// run that opens real poems leaves no record of them in the user's persistent log (the open handler
// logs every path it is asked to open). Unset in normal use, which keeps the defaults above.
const logDir = process.env.MIDST_LOG_DIR;
if (logDir) log.transports.file.resolvePath = () => join(logDir, 'main.log');

export type LogLevel =
  | 'error'
  | 'warn'
  | 'info'
  | 'verbose'
  | 'debug'
  | 'silly';

const LEVELS: LogLevel[] = [
  'error',
  'warn',
  'info',
  'verbose',
  'debug',
  'silly',
];
const DEFAULT_LEVEL: LogLevel = 'info';
export const LOG_LEVEL_KEY = 'logLevel';

const isLevel = (v: unknown): v is LogLevel =>
  typeof v === 'string' && (LEVELS as string[]).includes(v);

// An unrecognised stored value must not silence logging, so it falls back rather than being passed
// through to electron-log.
export function configuredLevel(): LogLevel {
  const stored = store.get(LOG_LEVEL_KEY);
  return isLevel(stored) ? stored : DEFAULT_LEVEL;
}

export function applyLogLevel(candidate?: unknown): LogLevel {
  const level = isLevel(candidate) ? candidate : configuredLevel();
  log.transports.file.level = level;
  log.transports.console.level = level;
  return level;
}

export default log;
