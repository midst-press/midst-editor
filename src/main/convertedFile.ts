import fs from 'fs';

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
