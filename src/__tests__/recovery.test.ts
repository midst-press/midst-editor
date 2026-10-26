/** @jest-environment node */
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { shell } from 'electron';
import {
  adopt,
  declineToTrash,
  forgetRecovery,
  orphans,
  recoveryFolder,
  startFresh,
  writeRecovery,
} from '../main/recovery';

// An untitled poem's recovery copy (#315). Synthetic documents only, in a temporary folder removed after each test.

let mockUserData = '';
const mockStore = new Map<string, unknown>();
jest.mock('electron', () => ({
  app: { getPath: () => mockUserData },
  shell: { trashItem: jest.fn(() => Promise.resolve()) },
}));
jest.mock('electron-log', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('../main/store', () => ({
  __esModule: true,
  default: {
    get: (k: string) => mockStore.get(k),
    set: (k: string, v: unknown) => mockStore.set(k, v),
  },
}));

const trashItem = shell.trashItem as jest.Mock;
const DOC = 'midstVersion: 1\n{"text":"<p>zq</p>","history":[],"meta":{}}';
const listing = () => fs.readdirSync(recoveryFolder()).sort();
const ownerOf = (id: string) =>
  JSON.parse(
    fs.readFileSync(path.join(recoveryFolder(), `${id}.owner`), 'utf8')
  );
const boot = () => Date.now() - os.uptime() * 1000;
// When a running process started, as ps tells it; startOrZero is 0 for a process that is not running.
const psStart = (pid: number) =>
  Date.parse(
    childProcess
      .execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
        env: { ...process.env, LC_ALL: 'C' },
      })
      .toString()
      .trim()
  );
const startOrZero = (pid: number) => {
  try {
    return psStart(pid);
  } catch {
    return 0;
  }
};
// A process id nothing is running as: the lowest one above the test's own that process.kill reports gone.
const deadPid = () => {
  for (let pid = 999_000; pid < 1_000_000; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return pid;
    }
  }
  throw new Error('no free process id found');
};

beforeEach(() => {
  mockUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-recovery-'));
  mockStore.clear();
  trashItem.mockClear();
  trashItem.mockImplementation(() => Promise.resolve());
});
afterEach(() => fs.rmSync(mockUserData, { recursive: true, force: true }));

describe('writeRecovery', () => {
  it('writes the whole document, and the id of the process writing it, under one id it keeps', () => {
    writeRecovery(DOC);
    const id = mockStore.get('recoveryId') as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      fs.readFileSync(path.join(recoveryFolder(), `${id}.midst`), 'utf8')
    ).toBe(DOC);
    const owner = ownerOf(id);
    expect(owner.pid).toBe(process.pid);
    expect(Math.abs(owner.boot - boot())).toBeLessThan(2000);
    expect(
      Math.abs(owner.started - (Date.now() - process.uptime() * 1000))
    ).toBeLessThan(2000);
    writeRecovery(`${DOC} `);
    expect(mockStore.get('recoveryId')).toBe(id);
    expect(listing()).toEqual([`${id}.midst`, `${id}.owner`]);
  });
});

describe('forgetRecovery', () => {
  it('removes the copy and its owner, and forgets the id', () => {
    writeRecovery(DOC);
    forgetRecovery();
    expect(listing()).toEqual([]);
    expect(mockStore.get('recoveryId')).toBe('');
  });

  it('with no untitled poem, changes nothing', () => {
    expect(() => forgetRecovery()).not.toThrow();
    expect(fs.existsSync(recoveryFolder())).toBe(false);
  });
});

describe('orphans', () => {
  // An owner is the pid, with this boot and the start ps reports for it unless given otherwise; a string is written
  // as it is.
  const plant = (
    id: string,
    owner: number | string | null,
    mtime: Date,
    { bootAt, startedAt }: { bootAt?: number; startedAt?: number } = {}
  ) => {
    fs.mkdirSync(recoveryFolder(), { recursive: true });
    fs.writeFileSync(path.join(recoveryFolder(), `${id}.midst`), DOC);
    fs.utimesSync(path.join(recoveryFolder(), `${id}.midst`), mtime, mtime);
    if (owner === null) return;
    const text =
      typeof owner === 'string'
        ? owner
        : JSON.stringify({
            pid: owner,
            boot: bootAt ?? boot(),
            started: startedAt ?? startOrZero(owner),
          });
    fs.writeFileSync(path.join(recoveryFolder(), `${id}.owner`), text);
  };
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const C = '33333333-3333-4333-8333-333333333333';

  it('offers every copy whose writer is gone or unknown, newest first', () => {
    plant(A, deadPid(), new Date('2026-10-01T10:00:00Z'));
    plant(B, null, new Date('2026-10-02T10:00:00Z'));
    expect(orphans().map((o) => o.id)).toEqual([B, A]);
  });

  it('never offers a copy another running Midst is writing', () => {
    plant(A, process.ppid, new Date());
    plant(C, deadPid(), new Date());
    expect(orphans().map((o) => o.id)).toEqual([C]);
  });

  // A process id is given out again, soonest after the computer restarts (vivian-1a61bc9a, cora-2f1e43dc, #326).
  it('offers a copy whose writer ran before the computer last started, though its id is running now', () => {
    plant(A, process.ppid, new Date(), { bootAt: boot() - 3_600_000 });
    expect(orphans().map((o) => o.id)).toEqual([A]);
  });

  it('offers a copy whose id now belongs to a process that started at another time', () => {
    plant(A, process.ppid, new Date(), {
      startedAt: psStart(process.ppid) - 3_600_000,
    });
    expect(orphans().map((o) => o.id)).toEqual([A]);
  });

  it('offers a copy whose owner file it cannot read as one', () => {
    plant(A, String(process.ppid), new Date());
    plant(B, '{"pid":', new Date());
    expect(
      orphans()
        .map((o) => o.id)
        .sort()
    ).toEqual([A, B]);
  });

  it("offers a copy carrying this process's own id: a crashed run's id can come round again", () => {
    plant(A, process.pid, new Date());
    expect(orphans().map((o) => o.id)).toEqual([A]);
  });

  it('offers nothing when there is no Recovery folder, and ignores files that are not recovery copies', () => {
    expect(orphans()).toEqual([]);
    fs.mkdirSync(recoveryFolder(), { recursive: true });
    fs.writeFileSync(
      path.join(
        recoveryFolder(),
        'Untitled (recovered 2026-10-26 17.52).midst'
      ),
      DOC
    );
    fs.writeFileSync(path.join(recoveryFolder(), 'notes.txt'), 'zq');
    expect(orphans()).toEqual([]);
  });

  it("adopting one makes it this window's untitled poem, written by this process", () => {
    plant(A, deadPid(), new Date());
    const [orphan] = orphans();
    adopt(orphan);
    expect(mockStore.get('recoveryId')).toBe(A);
    expect(ownerOf(A).pid).toBe(process.pid);
    expect(orphans()).toEqual([]);
  });

  it('startFresh forgets an id a crashed run left, without touching its copy', () => {
    plant(A, deadPid(), new Date());
    mockStore.set('recoveryId', A);
    startFresh();
    expect(mockStore.get('recoveryId')).toBe('');
    expect(orphans().map((o) => o.id)).toEqual([A]);
  });

  describe('declining', () => {
    it('moves the copy to the Trash under a name that says what it is, with no ":" or "/"', async () => {
      plant(A, deadPid(), new Date(2026, 9, 26, 17, 52));
      const [orphan] = orphans();
      await declineToTrash(orphan, 'Untitled');
      const named = path.join(
        recoveryFolder(),
        'Untitled (recovered 2026-10-26 17.52).midst'
      );
      expect(trashItem).toHaveBeenCalledWith(named);
      expect(path.basename(named)).not.toMatch(/[:/]/);
      expect(fs.existsSync(path.join(recoveryFolder(), `${A}.owner`))).toBe(
        false
      );
      expect(orphans()).toEqual([]);
    });

    it('when the Trash refuses it, keeps the copy, renamed so it is not offered again', async () => {
      trashItem.mockImplementation(() =>
        Promise.reject(new Error('zq no Trash'))
      );
      plant(A, deadPid(), new Date(2026, 9, 26, 17, 52));
      const [orphan] = orphans();
      await declineToTrash(orphan, 'Untitled');
      expect(listing()).toEqual([
        'Untitled (recovered 2026-10-26 17.52).midst',
      ]);
      expect(
        fs.readFileSync(path.join(recoveryFolder(), listing()[0]), 'utf8')
      ).toBe(DOC);
      expect(orphans()).toEqual([]);
    });

    it('when the copy cannot be renamed, leaves everything in place to be offered again', async () => {
      plant(A, deadPid(), new Date());
      const [orphan] = orphans();
      fs.rmSync(orphan.file);
      await declineToTrash(orphan, 'Untitled');
      expect(trashItem).not.toHaveBeenCalled();
      expect(listing()).toEqual([`${A}.owner`]);
    });

    it('never overwrites an earlier declined copy of the same minute', async () => {
      trashItem.mockImplementation(() =>
        Promise.reject(new Error('zq no Trash'))
      );
      plant(A, deadPid(), new Date(2026, 9, 26, 17, 52));
      plant(B, deadPid(), new Date(2026, 9, 26, 17, 52));
      const [first, second] = orphans();
      await declineToTrash(first, 'Untitled');
      await declineToTrash(second, 'Untitled');
      expect(listing()).toEqual([
        'Untitled (recovered 2026-10-26 17.52) 2.midst',
        'Untitled (recovered 2026-10-26 17.52).midst',
      ]);
    });
  });
});
