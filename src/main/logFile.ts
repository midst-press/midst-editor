// Where Midst's log is, for telling a poet (the error box) and for showing it (Help > Show Log File). A module of
// its own because logging.ts configures electron-log when it is imported, and these only read the file's path.
import log from 'electron-log';
import { homedir } from 'os';
import { sep } from 'path';

/** The log file's full path, as electron-log resolves it now. */
export const logFilePath = (): string => log.transports.file.getFile().path;

/** The path as a person would type it: the home folder as ~ (macOS and Linux), otherwise unchanged. */
export const logFileForPeople = (
  path: string = logFilePath(),
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform
): string =>
  platform !== 'win32' && home && path.startsWith(home + sep)
    ? `~${path.slice(home.length)}`
    : path;
