import fs from 'fs';
import path from 'path';

// Where the conversion of an old-format file is written: beside the original, as
// "<name>-converted.midst". If that name is taken, "<name>-converted-2.midst", then -3, and so on.
//
// A converted file is a poet's working copy from then on: they edit it and save over it. Opening the
// old file a second time used to write "<name>-converted.midst" again, replacing that work without
// asking. So the file is created with the 'wx' flag, which fails if anything already has the name
// (including a file that appeared after the name was chosen), and the next name is tried instead.

const MAX_ATTEMPTS = 1000;

export const convertedFilename = (oldFilename: string, attempt = 1) => {
  const stem = oldFilename.endsWith('.midst')
    ? oldFilename.slice(0, -6)
    : oldFilename;
  const suffix = attempt === 1 ? '' : `-${attempt}`;
  return `${stem}-converted${suffix}.midst`;
};

// Writes `contents` to the first free converted name for `oldFilename` and returns that name.
// Never replaces an existing file. Any failure other than "the name is taken" is thrown as it is.
export const writeConvertedFile = (oldFilename: string, contents: string) => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const filename = convertedFilename(oldFilename, attempt);
    try {
      fs.writeFileSync(filename, contents, { flag: 'wx' });
      return filename;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error(
    `No free name for the converted file after ${MAX_ATTEMPTS} attempts`
  );
};

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The converted copy a poet most likely means when they open `oldFilename` again: of the files beside it
// named as convertedFilename names them ("<name>-converted.midst", "<name>-converted-2.midst", ...), the one
// changed most recently, which holds their latest work (#7). Found by listing the folder, so a gap in the
// numbering (a deleted -converted.midst beside a -converted-2.midst) does not hide a copy. Undefined when
// there is none. Only regular files count: a symbolic link with the name is not a copy this app wrote, just
// as writeConvertedFile will not write through one. A folder that cannot be listed is thrown as it is, for the
// caller to log.
export const existingConvertedCopy = (oldFilename: string) => {
  const folder = path.dirname(oldFilename);
  const stem = path
    .basename(convertedFilename(oldFilename))
    .slice(0, -'-converted.midst'.length);
  const named = new RegExp(
    `^${escapeRegExp(stem)}-converted(?:-([2-9]|[1-9][0-9]+))?\\.midst$`
  );
  const copies = fs.readdirSync(folder).flatMap((name) => {
    const match = named.exec(name);
    if (!match) return [];
    const file = path.join(folder, name);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) return [];
    const attempt = match[1] === undefined ? 1 : Number(match[1]);
    return [{ file, mtimeMs: stat.mtimeMs, attempt }];
  });
  // Equal times (two copies written within a clock tick) go to the later copy, so the answer never rests on
  // the order the folder happens to list.
  copies.sort((a, b) => b.mtimeMs - a.mtimeMs || b.attempt - a.attempt);
  return copies[0]?.file;
};
