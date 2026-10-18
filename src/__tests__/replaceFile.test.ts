/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import replaceFile from '../main/replaceFile';

// Synthetic contents only: invented words, never a poem.

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-file-test-'));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const listing = () => fs.readdirSync(dir).sort();
const read = (p: string) => fs.readFileSync(p, 'utf8');
// <poem file>.<process id>-<n>.partial
const PARTIAL = new RegExp(`zq\\.midst\\.${process.pid}-\\d+\\.partial$`);

// A write that puts the first bytes on the disk and then fails, as a full disk does.
const failPartway = () => {
  const realWrite = fs.writeFileSync;
  jest.spyOn(fs, 'writeFileSync').mockImplementation(((
    file: fs.PathOrFileDescriptor,
    data: string
  ) => {
    realWrite(file, data.slice(0, 3));
    const err = new Error('ENOSPC: no space left on device, write');
    (err as NodeJS.ErrnoException).code = 'ENOSPC';
    throw err;
  }) as never);
};

describe('replaceFile (#95)', () => {
  it('creates a file that is not there yet, and leaves nothing else', () => {
    const target = path.join(dir, 'zq.midst');
    replaceFile(target, 'zq xv');
    expect(read(target)).toBe('zq xv');
    expect(listing()).toEqual(['zq.midst']);
  });

  it('replaces an existing file completely', () => {
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, 'earlier work, longer than the new');
    replaceFile(target, 'zq');
    expect(read(target)).toBe('zq');
    expect(listing()).toEqual(['zq.midst']);
  });

  it('a write that fails after the first bytes leaves the earlier file complete, and no temporary file', () => {
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, 'earlier work');
    failPartway();
    expect(() => replaceFile(target, 'zq xv qj')).toThrow('ENOSPC');
    expect(read(target)).toBe('earlier work');
    expect(listing()).toEqual(['zq.midst']);
  });

  it('a first save that fails part-way leaves no file at all', () => {
    const target = path.join(dir, 'zq.midst');
    failPartway();
    expect(() => replaceFile(target, 'zq xv qj')).toThrow('ENOSPC');
    expect(listing()).toEqual([]);
  });

  it('a rename that fails leaves the earlier file complete, and no temporary file', () => {
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, 'earlier work');
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EIO: zq');
    });
    expect(() => replaceFile(target, 'zq xv')).toThrow('EIO: zq');
    expect(read(target)).toBe('earlier work');
    expect(listing()).toEqual(['zq.midst']);
  });

  it('a cleanup that fails still throws the save’s own error, carrying the cleanup’s', () => {
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, 'earlier work');
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EIO: zq');
    });
    jest.spyOn(fs, 'rmSync').mockImplementation(() => {
      const e = new Error('EBUSY: xv') as NodeJS.ErrnoException;
      e.code = 'EBUSY';
      throw e;
    });
    let thrown:
      | (Error & { cleanupError?: Record<string, unknown> })
      | undefined;
    try {
      replaceFile(target, 'zq xv');
    } catch (err) {
      thrown = err as typeof thrown;
    }
    expect(thrown?.message).toBe('EIO: zq');
    expect(thrown?.cleanupError).toEqual({
      partial: expect.stringMatching(PARTIAL),
      code: 'EBUSY',
      message: 'EBUSY: xv',
    });
    expect(read(target)).toBe('earlier work');
  });

  it('flushes the new contents to the disk before the rename', () => {
    const order: string[] = [];
    const realFsync = fs.fsyncSync;
    const realRename = fs.renameSync;
    jest.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
      order.push('fsync');
      realFsync(fd);
    });
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      order.push('rename');
      realRename(from, to);
    });
    replaceFile(path.join(dir, 'zq.midst'), 'zq');
    expect(order).toEqual(['fsync', 'rename']);
  });

  it('writes the temporary file in the poem’s own folder, named after the poem, and a new name for each save', () => {
    const target = path.join(dir, 'zq.midst');
    const realRename = fs.renameSync;
    const from: string[] = [];
    jest.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
      from.push(String(a));
      realRename(a, b);
    });
    replaceFile(target, 'zq');
    replaceFile(target, 'xv');
    expect(from).toHaveLength(2);
    from.forEach((f) => expect(f).toMatch(PARTIAL));
    from.forEach((f) =>
      expect(fs.realpathSync(path.dirname(f))).toBe(fs.realpathSync(dir))
    );
    expect(from[0]).not.toBe(from[1]);
  });

  it('a temporary file that is already there is left alone, and the save takes the next name (#179, #182)', () => {
    // It may be the only copy of some work: left by a crash, or by a save whose cleanup failed.
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, 'earlier work');
    const realOpen = fs.openSync;
    const tried: string[] = [];
    jest.spyOn(fs, 'openSync').mockImplementation(((
      p: fs.PathLike,
      flags: fs.OpenMode
    ) => {
      tried.push(String(p));
      // A crashed run's leftover holds the first name this save tries.
      if (tried.length === 1) fs.writeFileSync(String(p), 'recovered work');
      return realOpen(p, flags);
    }) as never);
    replaceFile(target, 'zq xv');
    expect(read(target)).toBe('zq xv');
    expect(tried).toHaveLength(2);
    tried.forEach((t) => expect(t).toMatch(PARTIAL));
    expect(read(tried[0])).toBe('recovered work');
    expect(listing()).toEqual(['zq.midst', path.basename(tried[0])]);
  });

  it('beside too many leftovers, fails without touching any of them or the poem, and says so (#182)', () => {
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, 'earlier work');
    const realOpen = fs.openSync;
    jest.spyOn(fs, 'openSync').mockImplementation(((
      p: fs.PathLike,
      flags: fs.OpenMode
    ) => {
      fs.writeFileSync(String(p), 'recovered work');
      return realOpen(p, flags);
    }) as never);
    let thrown: NodeJS.ErrnoException | undefined;
    try {
      replaceFile(target, 'zq xv');
    } catch (err) {
      thrown = err as NodeJS.ErrnoException;
    }
    expect(thrown?.code).toBe('EEXIST');
    const message = thrown?.message ?? '';
    expect(message).toContain('100 temporary files from earlier saves');
    expect(message).toContain(target);
    expect(read(target)).toBe('earlier work');
    const leftovers = listing().filter((f) => f !== 'zq.midst');
    expect(leftovers).toHaveLength(100);
    leftovers.forEach((f) =>
      expect(read(path.join(dir, f))).toBe('recovered work')
    );
  });

  it('a failure names the poem’s file, not the temporary one', () => {
    const target = path.join(dir, 'no-such-folder', 'zq.midst');
    let message = '';
    try {
      replaceFile(target, 'zq');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('ENOENT');
    expect(message).toContain(target);
    expect(message).not.toContain('.partial');
  });

  it('keeps the file’s permissions', () => {
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, 'earlier work');
    fs.chmodSync(target, 0o640);
    replaceFile(target, 'zq');
    expect(fs.statSync(target).mode % 0o10000).toBe(0o640);
  });

  it('refuses a file the poet made read-only, and leaves it as it was', () => {
    // Root may write to a read-only file, so there is nothing to observe as root.
    if (process.getuid?.() === 0) return;
    const target = path.join(dir, 'zq.midst');
    fs.writeFileSync(target, 'earlier work');
    fs.chmodSync(target, 0o444);
    expect(() => replaceFile(target, 'zq')).toThrow(/EACCES|EPERM/);
    expect(read(target)).toBe('earlier work');
    expect(listing()).toEqual(['zq.midst']);
  });

  it('writes through a symbolic link to the file it points at, and keeps the link', () => {
    const real = path.join(dir, 'zq.midst');
    const link = path.join(dir, 'xv.midst');
    fs.writeFileSync(real, 'earlier work');
    fs.symlinkSync(real, link);
    replaceFile(link, 'zq');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(read(real)).toBe('zq');
    expect(listing()).toEqual(['xv.midst', 'zq.midst']);
  });

  it('a link whose file is gone is followed, and that file is created; the link stays (#182)', () => {
    const real = path.join(dir, 'zq.midst');
    const link = path.join(dir, 'xv.midst');
    fs.symlinkSync(real, link);
    replaceFile(link, 'zq');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(read(real)).toBe('zq');
    expect(listing()).toEqual(['xv.midst', 'zq.midst']);
  });

  it('a chain of links to a file that is gone, with a relative link, ends at that file (#182)', () => {
    fs.mkdirSync(path.join(dir, 'sub'));
    const real = path.join(dir, 'sub', 'zq.midst');
    const inner = path.join(dir, 'sub', 'qj.midst');
    const outer = path.join(dir, 'xv.midst');
    fs.symlinkSync('zq.midst', inner);
    fs.symlinkSync(inner, outer);
    replaceFile(outer, 'zq');
    expect(read(real)).toBe('zq');
    expect(fs.lstatSync(outer).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(inner).isSymbolicLink()).toBe(true);
  });

  it('links that point at each other fail with ELOOP, and create nothing (#182)', () => {
    const a = path.join(dir, 'zq.midst');
    const b = path.join(dir, 'xv.midst');
    fs.symlinkSync(b, a);
    fs.symlinkSync(a, b);
    expect(() => replaceFile(a, 'zq')).toThrow('ELOOP');
    expect(listing()).toEqual(['xv.midst', 'zq.midst']);
  });

  it('a dangling link that cannot be read is a failure to save, reported as it is (#182)', () => {
    const link = path.join(dir, 'xv.midst');
    fs.symlinkSync(path.join(dir, 'zq.midst'), link);
    const realLstat = fs.lstatSync;
    jest.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike) => {
      if (String(p) === link) {
        const err = new Error(`EACCES: permission denied, lstat '${link}'`);
        (err as NodeJS.ErrnoException).code = 'EACCES';
        throw err;
      }
      return realLstat(p);
    }) as never);
    expect(() => replaceFile(link, 'zq')).toThrow('EACCES');
    expect(listing()).toEqual(['xv.midst']);
  });

  it('gives up after 40 links, as the operating system does, and creates nothing (#182)', () => {
    const link = path.join(dir, 'xv.midst');
    fs.symlinkSync(path.join(dir, 'zq.midst'), link);
    // Every path reads as a link to the next, as an endless dangling chain would.
    jest
      .spyOn(fs, 'lstatSync')
      .mockImplementation((() => ({ isSymbolicLink: () => true })) as never);
    jest
      .spyOn(fs, 'readlinkSync')
      .mockImplementation((() => 'xv.midst') as never);
    expect(() => replaceFile(link, 'zq')).toThrow('ELOOP');
    expect(listing()).toEqual(['xv.midst']);
  });
});
