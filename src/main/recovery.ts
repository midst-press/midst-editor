import childProcess from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app, shell } from 'electron';
import log from 'electron-log';
import replaceFile from './replaceFile';
import store from './store';
import { describeError } from '../shared/errorSummary';

// An untitled poem's autosave (#315; Annelyse, GitHub midst-press/midst-editor#81). Until the poet saves on
// purpose, nothing asks where the poem goes: the editor's autosave writes it here instead, so a crash of Midst or of
// the computer does not take it. The next launch offers it back.
//
// - Each untitled poem is <userData>/Recovery/<id>.midst, a complete .midst file (text, history and meta, as a save
//   writes it), written through replaceFile: a temporary file, flushed, then renamed. A crash of Midst or of macOS
//   leaves the previous complete copy or the new one, never half of one. On macOS fsync does not force the drive's
//   own cache (that is F_FULLFSYNC), so a power cut can still lose the last write or two.
// - Beside it, <id>.owner names the process writing it: its id, when the computer started, and when the process
//   started. Only one Midst runs per userData folder (main.ts, the single-instance lock, #336), but a file whose
//   writer is still running is never offered all the same: it belongs to a live window. Process ids are handed out again, soonest after the
//   computer restarts, which is the crash this exists for (vivian-1a61bc9a and cora-2f1e43dc, review of #326). So a
//   live id counts only when the computer has not restarted since and that process started when the writer did.
//   Whatever cannot be decided offers the copy: a question about a poem another window holds is the safer mistake.
// - The file is removed only when the poet has saved the poem to a file of their own (after that write succeeded), or
//   chosen to discard it. Declining the offer at launch moves it to the Trash, never deletes it.
//
// The poem's text never reaches the log: ids, counts and error names only.

const ID_KEY = 'recoveryId';
// Two readings of the same start, from clocks that can disagree by this much, are the same start.
const SAME_START_MS = 60_000;
const SAME_PROCESS_MS = 10_000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const recoveryFolder = () =>
  path.join(app.getPath('userData'), 'Recovery');
const poemFile = (id: string) => path.join(recoveryFolder(), `${id}.midst`);
const ownerFile = (id: string) => path.join(recoveryFolder(), `${id}.owner`);

const currentId = (): string => {
  const id = store.get(ID_KEY) as string | undefined;
  return id && ID.test(id) ? id : '';
};

const bootTime = () => Date.now() - os.uptime() * 1000;
const processStart = () => Date.now() - process.uptime() * 1000;

interface Owner {
  pid: number;
  boot: number;
  started: number;
}

const writeOwner = (id: string) => {
  const owner: Owner = {
    pid: process.pid,
    boot: Math.round(bootTime()),
    started: Math.round(processStart()),
  };
  fs.writeFileSync(ownerFile(id), JSON.stringify(owner));
};

// Writes the untitled poem's recovery copy. Throws when it could not be written, as replaceFile does.
export const writeRecovery = (contents: string) => {
  let id = currentId();
  if (!id) {
    id = crypto.randomUUID();
    store.set(ID_KEY, id);
  }
  fs.mkdirSync(recoveryFolder(), { recursive: true });
  writeOwner(id);
  replaceFile(poemFile(id), contents);
};

// The poem has been saved to the poet's own file, or the poet chose to discard it: its recovery copy goes.
export const forgetRecovery = () => {
  const id = currentId();
  store.set(ID_KEY, '');
  if (!id) return;
  [poemFile(id), ownerFile(id)].forEach((file) => {
    try {
      fs.rmSync(file, { force: true });
    } catch (err) {
      log.error('recovery: a recovery file could not be removed', {
        id,
        ...describeError(err),
      });
    }
  });
};

// When the process with this id started, from ps; null when that cannot be told (no ps, as on Windows, or no such
// process).
const startOf = (pid: number): number | null => {
  try {
    const started = Date.parse(
      childProcess
        .execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
          env: { ...process.env, LC_ALL: 'C' },
          timeout: 2000,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        .toString()
        .trim()
    );
    return Number.isNaN(started) ? null : started;
  } catch {
    return null;
  }
};

// Whether the process that wrote a recovery file is still running. Anything this cannot be sure of is not running.
const running = (owner: unknown) => {
  const { pid, boot, started } = (owner ?? {}) as Partial<Owner>;
  if (!Number.isInteger(pid) || (pid as number) <= 0 || pid === process.pid)
    return false;
  if (typeof boot !== 'number' || typeof started !== 'number') return false;
  // The computer has restarted since: whatever has this id now is not the writer.
  if (Math.abs(bootTime() - boot) > SAME_START_MS) return false;
  try {
    process.kill(pid as number, 0);
  } catch {
    // Gone, or (EPERM) another user's process: a Midst writing this poet's folder runs as the poet.
    return false;
  }
  const liveStart = startOf(pid as number);
  return liveStart !== null && Math.abs(liveStart - started) <= SAME_PROCESS_MS;
};

export interface Orphan {
  id: string;
  file: string;
  lastWritten: Date;
}

// The recovery files no running Midst is writing, newest first, leaving out this window's own. A folder that cannot be
// read offers nothing.
export const orphans = (): Orphan[] => {
  const own = currentId();
  let names: string[];
  try {
    names = fs.readdirSync(recoveryFolder());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      log.error(
        'recovery: the recovery folder could not be read',
        describeError(err)
      );
    return [];
  }
  const found: Orphan[] = [];
  names.forEach((name) => {
    const id = name.endsWith('.midst') ? name.slice(0, -'.midst'.length) : '';
    if (!ID.test(id) || id === own) return;
    let owner: unknown;
    try {
      owner = JSON.parse(fs.readFileSync(ownerFile(id), 'utf8'));
    } catch {
      // No owner file, or not one this version wrote: nothing is known to be writing it.
    }
    if (running(owner)) return;
    try {
      found.push({
        id,
        file: poemFile(id),
        lastWritten: fs.statSync(poemFile(id)).mtime,
      });
    } catch (err) {
      log.error('recovery: a recovery file could not be read', {
        id,
        ...describeError(err),
      });
    }
  });
  return found.sort(
    (a, b) => b.lastWritten.getTime() - a.lastWritten.getTime()
  );
};

// The poet chose to recover this poem: it is this window's untitled poem now, and autosave goes on writing it.
export const adopt = (orphan: Orphan) => {
  store.set(ID_KEY, orphan.id);
  writeOwner(orphan.id);
};

// "2026-10-26 17.52": no ':' or '/', which a file name in the Trash cannot carry well.
const stamp = (d: Date) => {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;
};

// The poet declined the offer: the poem goes to the Trash under a name that says what it is, where it can still be
// taken back. If it cannot be moved there it stays, renamed so it is not offered again, and the log says so. Never
// deleted.
export const declineToTrash = async (orphan: Orphan, untitled: string) => {
  const base = `${untitled} (recovered ${stamp(orphan.lastWritten)})`;
  let named = path.join(recoveryFolder(), `${base}.midst`);
  for (let n = 2; fs.existsSync(named); n += 1)
    named = path.join(recoveryFolder(), `${base} ${n}.midst`);
  try {
    fs.renameSync(orphan.file, named);
  } catch (err) {
    log.error(
      'recovery: a declined recovery file could not be renamed; it stays and will be offered again',
      {
        id: orphan.id,
        ...describeError(err),
      }
    );
    return;
  }
  fs.rmSync(ownerFile(orphan.id), { force: true });
  try {
    await shell.trashItem(named);
    log.info('recovery: a declined recovery file was moved to the Trash', {
      id: orphan.id,
    });
  } catch (err) {
    log.error(
      'recovery: a declined recovery file could not be moved to the Trash; it stays in the Recovery folder',
      {
        id: orphan.id,
        ...describeError(err),
      }
    );
  }
};

// At launch nothing is this process's yet: a recovery id left in the store by a run that crashed is only an orphan.
export const startFresh = () => store.set(ID_KEY, '');
