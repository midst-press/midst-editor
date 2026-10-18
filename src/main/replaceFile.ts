import fs from 'fs';
import path from 'path';

// How a poem's file is written (#95). Writing straight onto the file empties it first, so a write that
// failed part-way (a full disk, a drive that went away, a crash or a power cut) left a truncated poem:
// the last good save gone and the new one not there.
//
// So the new contents are written to a temporary file beside the poem, flushed to the disk, and then
// renamed over it. A rename within one folder replaces the file in one step, so the poem's file is
// always either the previous complete save or the new complete save.
//
// - The temporary file is "<poem file>.<process id>-<n>.partial", in the poem's own folder: a rename to
//   another volume would be a copy, not a single step. <n> counts this process's saves, so no two saves
//   share a name. It holds the poem's text, so it is removed on any failure, and the name says whose file
//   it was if a crash ever leaves one behind.
// - Only a temporary file THIS save created is ever removed. One already there (left by a crash, or by a
//   save whose cleanup failed) may be the only copy of some work, so it is left alone, and the save takes
//   the next free name (#182). A crashed run's process id can come round again, and <n> starts again at
//   each launch, so such a name is taken more often than it looks.
// - A file the poet has made read-only is refused, as writing onto it was. A rename only needs the
//   folder to be writable, so without this check it would replace a file the poet locked.
// - The file's permissions are kept: the new file is given the old one's mode.
// - A poem reached through a symbolic link is written to the file the link points at. The link stays. A
//   link whose file is gone is followed too, and that file is created, as writing onto the link did (#182).
// - A folder the poet may change files in but not create files in now fails, where writing onto the
//   file did not. The poet is told, as for any failed save, and the document stays unsaved.
let saves = 0;
// More leftovers than this beside one poem is not a crash: the save stops rather than search forever.
const MAX_NAME_TRIES = 100;
// Symbolic links followed before giving up, as the operating system does (ELOOP).
const MAX_LINKS = 40;

// Where a link whose file is gone points: the path writing onto it would have created.
const danglingTarget = (filename: string): string => {
  let p = filename;
  for (let i = 0; i < MAX_LINKS; i += 1) {
    let link: boolean;
    try {
      link = fs.lstatSync(p).isSymbolicLink();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return p;
      throw err;
    }
    if (!link) return p;
    p = path.resolve(path.dirname(p), fs.readlinkSync(p));
  }
  const err = new Error(`ELOOP: too many symbolic links, open '${filename}'`);
  (err as NodeJS.ErrnoException).code = 'ELOOP';
  throw err;
};

const replaceFile = (filename: string, contents: string) => {
  let target = filename;
  let mode: number | undefined;
  try {
    target = fs.realpathSync(filename);
    mode = fs.statSync(target).mode % 0o10000;
    fs.accessSync(target, fs.constants.W_OK);
  } catch (err) {
    // No file there yet: it is created, at the end of any link that points to it. Anything else (a
    // read-only file, a folder that cannot be read) is a failure to save, reported as it is.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    target = danglingTarget(filename);
  }

  let partial = '';
  let fd: number | undefined;
  let created = false;
  try {
    for (let tries = 1; fd === undefined; tries += 1) {
      saves += 1;
      partial = `${target}.${process.pid}-${saves}.partial`;
      try {
        fd = fs.openSync(partial, 'wx');
      } catch (err) {
        // Someone else's leftover: leave it, and take the next name.
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        if (tries >= MAX_NAME_TRIES) {
          const full = new Error(
            `EEXIST: ${MAX_NAME_TRIES} temporary files from earlier saves are beside '${target}'; none was touched`
          );
          (full as NodeJS.ErrnoException).code = 'EEXIST';
          throw full;
        }
      }
    }
    created = true;
    if (mode !== undefined) fs.fchmodSync(fd, mode);
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(partial, target);
    created = false;
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // The write's own error is the one to report.
      }
    }
    if (created) {
      try {
        fs.rmSync(partial, { force: true });
      } catch (cleanup) {
        // The save's own error is still the one thrown. The leftover file is named on it, for the log.
        const c = cleanup as NodeJS.ErrnoException;
        (err as { cleanupError?: unknown }).cleanupError = {
          partial,
          code: c.code,
          message: c.message,
        };
      }
    }
    // The poet is shown this message, and the temporary name means nothing to them: name their file.
    const e = err as Error;
    if (typeof e.message === 'string')
      e.message = e.message.split(partial).join(target);
    throw err;
  }
};

export default replaceFile;
