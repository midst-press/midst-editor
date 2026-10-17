// A development build keeps its own store and log (Gitea #151). `npm start`'s app takes its name from
// package.json, "midst"; the installed app is "Midst". On macOS's case-insensitive disks those name the
// same folders, so without this a dev build reads and writes a poet's real store (the open poem, its
// history) and appends to, and rotates, the installed app's log.
//
// Imported FIRST in main.ts: electron-store reads the userData path when store.ts is imported, and
// logging.ts reads MIDST_LOG_DIR when it is imported. A packaged app is left alone, and so is a launch
// that names its own folder (--user-data-dir, MIDST_LOG_DIR), as the end-to-end specs do.
import { app } from 'electron';
import path from 'path';

export const DEV_FOLDER = 'midst-dev';

type AppLike = Pick<typeof app, 'isPackaged' | 'getPath' | 'setPath'> & {
  commandLine: Pick<typeof app.commandLine, 'hasSwitch'>;
};

/** Where a development build's store and log go. Returns what it changed, for the log and the tests. */
export function separateDevState(
  a: AppLike,
  env: NodeJS.ProcessEnv
): { userData?: string; logDir?: string } {
  if (a.isPackaged) return {};
  const base = path.join(a.getPath('appData'), DEV_FOLDER);
  const changed: { userData?: string; logDir?: string } = {};
  if (!a.commandLine.hasSwitch('user-data-dir')) {
    a.setPath('userData', base);
    changed.userData = base;
  }
  if (!env.MIDST_LOG_DIR) {
    const logDir = path.join(base, 'logs');
    env.MIDST_LOG_DIR = logDir;
    changed.logDir = logDir;
  }
  return changed;
}

separateDevState(app, process.env);
