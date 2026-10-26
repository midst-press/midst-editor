import crypto from 'crypto';
import fs from 'fs';
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
// - Beside it, <id>.owner holds the process id writing it. A second copy of Midst can run (there is no single-instance
//   lock), and a file whose writer is still running is never offered: it belongs to a live window.
// - The file is removed only when the poet has saved the poem to a file of their own (after that write succeeded), or
//   chosen to discard it. Declining the offer at launch moves it to the Trash, never deletes it.
//
// The poem's text never reaches the log: ids, counts and error names only.

const ID_KEY = 'recoveryId';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const recoveryFolder = () =>
  path.join(app.getPath('userData'), 'Recovery');
const poemFile = (id: string) => path.join(recoveryFolder(), `${id}.midst`);
const ownerFile = (id: string) => path.join(recoveryFolder(), `${id}.owner`);

const currentId = (): string => {
  const id = store.get(ID_KEY) as string | undefined;
  return id && ID.test(id) ? id : '';
};

// Writes the untitled poem's recovery copy. Throws when it could not be written, as replaceFile does.
export const writeRecovery = (contents: string) => {
  let id = currentId();
  if (!id) {
    id = crypto.randomUUID();
    store.set(ID_KEY, id);
  }
  fs.mkdirSync(recoveryFolder(), { recursive: true });
  fs.writeFileSync(ownerFile(id), String(process.pid));
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

// Whether the process that wrote a recovery file is still running. EPERM means it exists but is someone else's.
const running = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
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
    let owner = NaN;
    try {
      owner = Number(fs.readFileSync(ownerFile(id), 'utf8').trim());
    } catch {
      // No owner file: nothing is writing it.
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
  fs.writeFileSync(ownerFile(orphan.id), String(process.pid));
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
