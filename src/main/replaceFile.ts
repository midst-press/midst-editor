import fs from 'fs';

// How a poem's file is written (#95). Writing straight onto the file empties it first, so a write that
// failed part-way (a full disk, a drive that went away, a crash or a power cut) left a truncated poem:
// the last good save gone and the new one not there.
//
// So the new contents are written to a temporary file beside the poem, flushed to the disk, and then
// renamed over it. A rename within one folder replaces the file in one step, so the poem's file is
// always either the previous complete save or the new complete save.
//
// - The temporary file is "<poem file>.<process id>.partial", in the poem's own folder: a rename to
//   another volume would be a copy, not a single step. It holds the poem's text, so it is removed on any
//   failure, and the name says whose file it was if a crash ever leaves one behind.
// - A file the poet has made read-only is refused, as writing onto it was. A rename only needs the
//   folder to be writable, so without this check it would replace a file the poet locked.
// - The file's permissions are kept: the new file is given the old one's mode.
// - A poem reached through a symbolic link is written to the file the link points at. The link stays.
// - A folder the poet may change files in but not create files in now fails, where writing onto the
//   file did not. The poet is told, as for any failed save, and the document stays unsaved.
const replaceFile = (filename: string, contents: string) => {
  let target = filename;
  let mode: number | undefined;
  try {
    target = fs.realpathSync(filename);
    mode = fs.statSync(target).mode % 0o10000;
    fs.accessSync(target, fs.constants.W_OK);
  } catch (err) {
    // No file there yet: it is created. Anything else (a read-only file, a folder that cannot be
    // read) is a failure to save, reported as it is.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const partial = `${target}.${process.pid}.partial`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(partial, 'wx');
    if (mode !== undefined) fs.fchmodSync(fd, mode);
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(partial, target);
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // The write's own error is the one to report.
      }
    }
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
    // The poet is shown this message, and the temporary name means nothing to them: name their file.
    const e = err as Error;
    if (typeof e.message === 'string')
      e.message = e.message.split(partial).join(target);
    throw err;
  }
};

export default replaceFile;
