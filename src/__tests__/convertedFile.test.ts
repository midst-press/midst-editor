/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  convertedFilename,
  existingConvertedCopy,
  writeConvertedFile,
} from '../main/convertedFile';

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

  // #210: when every name it may use is taken, it says so and writes over none of them.
  it('throws when all 1000 names are taken, and every one is left as it was', () => {
    const names = Array.from({ length: 1000 }, (_, i) =>
      path.basename(convertedFilename('poem.midst', i + 1))
    );
    names.forEach((name) => fs.writeFileSync(path.join(dir, name), name));
    expect(() =>
      writeConvertedFile(path.join(dir, 'poem.midst'), 'new')
    ).toThrow('No free name for the converted file after 1000 attempts');
    expect(fs.readdirSync(dir).sort()).toEqual([...names].sort());
    names.forEach((name) => expect(read(name)).toBe(name));
  });
});

describe('finding an earlier converted copy (#7)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'converted-copy-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const at = (name: string) => path.join(dir, name);
  const write = (name: string, secondsAgo: number) => {
    fs.writeFileSync(at(name), 'zq');
    const t = Date.now() / 1000 - secondsAgo;
    fs.utimesSync(at(name), t, t);
  };
  const old = () => at('poem.midst');

  it('finds none when nothing has been converted', () => {
    write('poem.midst', 0);
    expect(existingConvertedCopy(old())).toBeUndefined();
  });

  it('finds <name>-converted.midst', () => {
    write('poem-converted.midst', 10);
    expect(existingConvertedCopy(old())).toBe(at('poem-converted.midst'));
  });

  it('offers the copy changed most recently, not the first or the highest numbered', () => {
    write('poem-converted.midst', 10);
    write('poem-converted-2.midst', 300);
    write('poem-converted-3.midst', 200);
    expect(existingConvertedCopy(old())).toBe(at('poem-converted.midst'));
  });

  it('finds a copy across a gap in the numbering', () => {
    write('poem-converted-3.midst', 10);
    expect(existingConvertedCopy(old())).toBe(at('poem-converted-3.midst'));
  });

  it('breaks a tie in time by the later copy', () => {
    write('poem-converted.midst', 50);
    write('poem-converted-2.midst', 50);
    expect(existingConvertedCopy(old())).toBe(at('poem-converted-2.midst'));
  });

  it('is not fooled by names that only look like a copy', () => {
    write('poem-converted-x.midst', 0);
    write('poem-converted-1.midst', 0);
    write('poem-converted-02.midst', 0);
    write('poem-converted.midst.bak', 0);
    write('mypoem-converted.midst', 0);
    write('poem-converted.txt', 0);
    fs.mkdirSync(at('poem-converted-4.midst'));
    expect(existingConvertedCopy(old())).toBeUndefined();
  });

  it('reads a name with characters a pattern would treat specially as plain text', () => {
    write('a.b (1)+[x]-converted.midst', 0);
    write('aXb (1)+[x]-converted.midst', 0);
    expect(existingConvertedCopy(at('a.b (1)+[x].midst'))).toBe(
      at('a.b (1)+[x]-converted.midst')
    );
  });

  it('does not count a symbolic link with the name', () => {
    write('elsewhere.txt', 0);
    fs.symlinkSync(at('elsewhere.txt'), at('poem-converted.midst'));
    expect(existingConvertedCopy(old())).toBeUndefined();
  });

  it('throws when the folder cannot be listed', () => {
    expect(() =>
      existingConvertedCopy(path.join(dir, 'no-such-folder', 'poem.midst'))
    ).toThrow(/ENOENT/);
  });
});
