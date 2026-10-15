import log from 'electron-log';
import { existsSync, renameSync, rmSync } from 'fs';
import { join, parse } from 'path';
import { describeError } from '../shared/errorSummary';
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

// ---- The file is strict JSONL: one JSON object per line, so a person or a script can read it back.
// {"ts": <ISO>, "level", "source": "main"|"renderer", "msg": <fixed text>, "meta": <value, omitted when
// there is none>}. The console keeps electron-log's human format.

export type LogRecord = {
  date: Date;
  level: string;
  scope?: { label?: string } | null;
  data: unknown[];
};

// Errors are reduced to name + frames (never the message, which can quote a file's content),
// circular references and bigints are made representable. Tracks ancestors rather than every value
// seen, so the same object appearing twice in a tree is not mistaken for a cycle.
function makeReplacer() {
  const ancestors: object[] = [];
  return function replacer(this: unknown, _key: string, raw: unknown) {
    if (typeof raw === 'bigint') return raw.toString();
    const value = raw instanceof Error ? describeError(raw) : raw;
    if (typeof value !== 'object' || value === null) return value;
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop();
    }
    if (ancestors.includes(value)) return '[circular]';
    ancestors.push(value);
    return value;
  };
}

function isoOf(date: unknown): string {
  const when =
    date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return when.toISOString();
}

// Runs inside the log transport, so it must never throw: a failure to format one entry may not
// cost the caller its own error handling. Pure, for testing without electron-log.
export function formatRecord(record: LogRecord): string {
  const ts = isoOf(record.date);
  const level = String(record.level);
  const source = record.scope?.label === 'renderer' ? 'renderer' : 'main';
  try {
    const { data } = record;
    const hasMsg = typeof data[0] === 'string';
    const rest = hasMsg ? data.slice(1) : data;
    const entry: Record<string, unknown> = {
      ts,
      level,
      source,
      msg: hasMsg ? data[0] : '',
    };
    if (rest.length === 1) [entry.meta] = rest;
    else if (rest.length > 1) entry.meta = rest;
    return JSON.stringify(entry, makeReplacer());
  } catch (e) {
    return JSON.stringify({
      ts,
      level,
      source,
      msg: 'log entry could not be serialised',
      error: e instanceof Error ? String(e.name) : typeof e,
    });
  }
}

log.transports.file.format = (message: LogRecord) => formatRecord(message);

// ---- Rotation: main.log -> main.1.log -> ... -> main.5.log, the oldest dropped.
export const ARCHIVES_KEPT = 5;
export const MAX_LOG_BYTES = 5 * 1024 * 1024;
const CROP_BYTES = 256 * 1024;

/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
type LogFile = { toString: () => string; crop: (bytesAfter?: number) => void };
type Report = (message: string, error: unknown) => void;
/* eslint-enable no-unused-vars */

export function rotateLogs(
  file: LogFile,
  report: Report,
  kept: number = ARCHIVES_KEPT
): void {
  const { dir, name, ext } = parse(file.toString());
  const archive = (n: number) => join(dir, `${name}.${n}${ext}`);
  try {
    rmSync(archive(kept), { force: true });
    for (let n = kept - 1; n >= 1; n -= 1) {
      if (existsSync(archive(n))) renameSync(archive(n), archive(n + 1));
    }
    renameSync(file.toString(), archive(1));
  } catch (e) {
    // The transport's own fallback: keep the tail of the file rather than let it grow without bound.
    report('Could not rotate log', e);
    file.crop(CROP_BYTES);
  }
}

log.transports.file.maxSize = MAX_LOG_BYTES;
log.transports.file.archiveLog = (file) =>
  // `crop` exists at runtime on electron-log's file object but not in its typings.
  rotateLogs(file as unknown as LogFile, (message, error) =>
    log.transports.console({
      data: [`electron-log.transports.file: ${message}`, error],
      date: new Date(),
      level: 'warn',
    })
  );

// ---- Errors nothing caught. The log has the name and frames (never the message); the poet is told
// through `notify`, as Electron's own handler would have, and the app keeps running.
/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
type ProcessLike = {
  on: (
    event: 'uncaughtException' | 'unhandledRejection',
    fn: (e: unknown) => void
  ) => unknown;
};
type Notify = (name: string) => void;
/* eslint-enable no-unused-vars */

export function registerUncaughtHandlers(
  proc: ProcessLike,
  notify: Notify
): void {
  const handle = (error: unknown) => {
    const summary = describeError(error);
    log.error('uncaught error', summary);
    try {
      notify(summary.name);
    } catch (e) {
      log.error(
        'could not tell the user about an uncaught error',
        describeError(e)
      );
    }
  };
  proc.on('uncaughtException', handle);
  proc.on('unhandledRejection', handle);
}

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
