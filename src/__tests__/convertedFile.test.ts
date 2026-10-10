/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { convertedFilename, writeConvertedFile } from '../main/convertedFile';

// Synthetic contents only. The files are named .midst because the names are what is under test; they
// live in a temporary directory and are removed after each test.
describe('writing a converted file', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'converted-file-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');

  it('names the conversion beside the original', () => {
    expect(convertedFilename('/a/poem.midst')).toBe('/a/poem-converted.midst');
    expect(convertedFilename('/a/poem')).toBe('/a/poem-converted.midst');
    expect(convertedFilename('/a/poem.midst', 3)).toBe(
      '/a/poem-converted-3.midst'
    );
  });

  it('writes <name>-converted.midst when that name is free', () => {
    const written = writeConvertedFile(path.join(dir, 'poem.midst'), 'new');
    expect(written).toBe(path.join(dir, 'poem-converted.midst'));
    expect(read('poem-converted.midst')).toBe('new');
  });

  it('keeps an existing converted file and takes the next name', () => {
    fs.writeFileSync(path.join(dir, 'poem-converted.midst'), 'months of work');
    const written = writeConvertedFile(path.join(dir, 'poem.midst'), 'new');
    expect(written).toBe(path.join(dir, 'poem-converted-2.midst'));
    expect(read('poem-converted.midst')).toBe('months of work');
    expect(read('poem-converted-2.midst')).toBe('new');
  });

  it('skips every taken name, not only the first', () => {
    fs.writeFileSync(path.join(dir, 'poem-converted.midst'), 'first');
    fs.writeFileSync(path.join(dir, 'poem-converted-2.midst'), 'second');
    const written = writeConvertedFile(path.join(dir, 'poem.midst'), 'new');
    expect(written).toBe(path.join(dir, 'poem-converted-3.midst'));
    expect(read('poem-converted.midst')).toBe('first');
    expect(read('poem-converted-2.midst')).toBe('second');
  });

  it('does not write through a symbolic link that has the name', () => {
    fs.writeFileSync(path.join(dir, 'elsewhere.txt'), 'elsewhere');
    fs.symlinkSync(
      path.join(dir, 'elsewhere.txt'),
      path.join(dir, 'poem-converted.midst')
    );
    const written = writeConvertedFile(path.join(dir, 'poem.midst'), 'new');
    expect(written).toBe(path.join(dir, 'poem-converted-2.midst'));
    expect(read('elsewhere.txt')).toBe('elsewhere');
  });

  it('throws a failure that is not a taken name, and writes nothing', () => {
    const missing = path.join(dir, 'no-such-folder', 'poem.midst');
    expect(() => writeConvertedFile(missing, 'new')).toThrow(/ENOENT/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
