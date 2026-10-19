/** @jest-environment node */
/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
import fs from 'fs';
import os from 'os';
import path from 'path';

// Synthetic values only. Each test loads logging.ts afresh (the MIDST_LOG_DIR check runs at import),
// so the mocks are rebuilt per load and nothing carries between tests.
jest.mock('electron-log', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    transports: {
      file: { level: 'untouched' },
      console: Object.assign(jest.fn(), { level: 'untouched' }),
    },
  },
}));
jest.mock('../main/store', () => {
  const values = new Map<string, unknown>();
  return {
    __esModule: true,
    default: {
      get: (k: string) => values.get(k),
      set: (k: string, v: unknown) => values.set(k, v),
    },
  };
});

type Transport = { level: string; resolvePathFn?: unknown };
type FileTransport = Transport & {
  format: (params: { message: unknown }) => unknown[];
  maxSize: number;
  archiveLogFn: (file: unknown) => void;
};
type Loaded = {
  mod: typeof import('../main/logging');
  log: {
    error: jest.Mock;
    transports: { file: FileTransport; console: Transport & jest.Mock };
  };
  store: Pick<Map<string, unknown>, 'set'>;
};

const load = (): Loaded => {
  let loaded: Loaded | undefined;
  jest.isolateModules(() => {
    /* eslint-disable global-require */
    loaded = {
      mod: require('../main/logging'),
      log: require('electron-log').default,
      store: require('../main/store').default,
    };
    /* eslint-enable global-require */
  });
  return loaded as Loaded;
};

describe('logging', () => {
  const savedEnv = process.env;

  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.MIDST_LOG_DIR;
  });
  afterEach(() => {
    process.env = savedEnv;
  });

  describe('configuredLevel', () => {
    it('defaults to info when nothing is stored', () => {
      const { mod } = load();
      expect(mod.configuredLevel()).toBe('info');
    });

    // The key is what a person types into the settings file to raise the level, so its spelling
    // is part of the contract, not only the exported constant.
    it('reads the level from the store key "logLevel"', () => {
      const { mod, store } = load();
      store.set('logLevel', 'debug');
      expect(mod.configuredLevel()).toBe('debug');
    });

    it.each(['error', 'warn', 'info', 'verbose', 'debug', 'silly'])(
      'returns the stored level %s',
      (level) => {
        const { mod, store } = load();
        store.set(mod.LOG_LEVEL_KEY, level);
        expect(mod.configuredLevel()).toBe(level);
      }
    );

    it.each([
      ['an unknown string', 'chatty'],
      ['the wrong case', 'DEBUG'],
      ['an empty string', ''],
      ['a number', 3],
      ['null', null],
      ['an object', { level: 'debug' }],
    ])('falls back to info for %s', (_label, value) => {
      const { mod, store } = load();
      store.set(mod.LOG_LEVEL_KEY, value);
      expect(mod.configuredLevel()).toBe('info');
    });
  });

  describe('applyLogLevel', () => {
    it('applies a valid candidate to both transports and returns it', () => {
      const { mod, log, store } = load();
      store.set(mod.LOG_LEVEL_KEY, 'warn');
      expect(mod.applyLogLevel('debug')).toBe('debug');
      expect(log.transports.file.level).toBe('debug');
      expect(log.transports.console.level).toBe('debug');
    });

    it('uses the configured level when no candidate is given', () => {
      const { mod, log, store } = load();
      store.set(mod.LOG_LEVEL_KEY, 'verbose');
      expect(mod.applyLogLevel()).toBe('verbose');
      expect(log.transports.file.level).toBe('verbose');
      expect(log.transports.console.level).toBe('verbose');
    });

    it('uses info when there is neither a candidate nor a stored level', () => {
      const { mod, log } = load();
      expect(mod.applyLogLevel()).toBe('info');
      expect(log.transports.file.level).toBe('info');
      expect(log.transports.console.level).toBe('info');
    });

    it.each([
      ['an unknown string', 'chatty'],
      ['the wrong case', 'Warn'],
      ['a number', 2],
      ['null', null],
    ])('ignores %s as a candidate and uses the configured level', (_l, bad) => {
      const { mod, log, store } = load();
      store.set(mod.LOG_LEVEL_KEY, 'error');
      expect(mod.applyLogLevel(bad)).toBe('error');
      expect(log.transports.file.level).toBe('error');
      expect(log.transports.console.level).toBe('error');
    });

    it('leaves the transports untouched until it is called', () => {
      const { log } = load();
      expect(log.transports.file.level).toBe('untouched');
      expect(log.transports.console.level).toBe('untouched');
    });
  });

  describe('MIDST_LOG_DIR', () => {
    it('points the file transport at <dir>/main.log when set', () => {
      const dir = path.join('some', 'scratch-dir');
      process.env.MIDST_LOG_DIR = dir;
      const { log } = load();
      const resolve = log.transports.file.resolvePathFn as () => string;
      expect(resolve()).toBe(path.join(dir, 'main.log'));
    });

    it('leaves resolvePathFn alone when unset', () => {
      const { log } = load();
      expect(log.transports.file.resolvePathFn).toBeUndefined();
    });

    it('leaves resolvePathFn alone when set to an empty string', () => {
      process.env.MIDST_LOG_DIR = '';
      const { log } = load();
      expect(log.transports.file.resolvePathFn).toBeUndefined();
    });
  });

  // ---- the strict JSONL line ----
  describe('formatRecord', () => {
    const date = new Date('2026-10-16T01:02:03.456Z');
    const record = (data: unknown[], scope?: string) => ({
      date,
      level: 'warn',
      scope,
      data,
    });
    const fmt = (data: unknown[], scope?: string) => {
      const { mod } = load();
      const line = mod.formatRecord(record(data, scope));
      expect(line).not.toContain('\n');
      return { line, parsed: JSON.parse(line) as Record<string, unknown> };
    };

    it('writes ts, level, source, msg and meta for a string and an object', () => {
      const { line, parsed } = fmt(['zq happened', { n: 1, tag: 'xv' }]);
      expect(parsed).toEqual({
        ts: '2026-10-16T01:02:03.456Z',
        level: 'warn',
        source: 'main',
        msg: 'zq happened',
        meta: { n: 1, tag: 'xv' },
      });
      expect(Object.keys(parsed)).toEqual([
        'ts',
        'level',
        'source',
        'msg',
        'meta',
      ]);
      expect(line.startsWith('{"ts":')).toBe(true);
    });

    it('omits meta when there is only a string', () => {
      const { parsed } = fmt(['zq only']);
      expect(parsed.msg).toBe('zq only');
      expect('meta' in parsed).toBe(false);
    });

    it('puts several further arguments in meta as an array', () => {
      const { parsed } = fmt(['zq', 1, { a: 2 }, 'three']);
      expect(parsed.meta).toEqual([1, { a: 2 }, 'three']);
    });

    it('keeps a single non-object meta as the value itself', () => {
      expect(fmt(['zq', 7]).parsed.meta).toBe(7);
      expect(fmt(['zq', null]).parsed.meta).toBeNull();
    });

    it('has an empty msg and keeps every argument in meta when the first is not a string', () => {
      const { parsed } = fmt([{ a: 1 }]);
      expect(parsed.msg).toBe('');
      expect(parsed.meta).toEqual({ a: 1 });
      expect(fmt([1, 2]).parsed.meta).toEqual([1, 2]);
    });

    it('has an empty msg and no meta for no arguments', () => {
      const { parsed } = fmt([]);
      expect(parsed.msg).toBe('');
      expect('meta' in parsed).toBe(false);
    });

    it('is source main without a scope or with another scope, renderer for the renderer scope', () => {
      expect(fmt(['zq']).parsed.source).toBe('main');
      expect(fmt(['zq'], 'other').parsed.source).toBe('main');
      expect(fmt(['zq'], '').parsed.source).toBe('main');
      expect(fmt(['zq'], 'renderer').parsed.source).toBe('renderer');
    });

    it('keeps newlines inside a message on one line', () => {
      const { parsed } = fmt(['zq\nxv', { s: 'a\nb\r\nc' }]);
      expect(parsed.msg).toBe('zq\nxv');
      expect(parsed.meta).toEqual({ s: 'a\nb\r\nc' });
    });

    describe('an Error', () => {
      const SECRET = 'the quick brown fox';
      const failing = () => {
        const e = new TypeError(`unexpected ${SECRET}\nsecond ${SECRET} line`);
        return e;
      };

      it('becomes its name and frames, and its message appears nowhere', () => {
        const { line, parsed } = fmt(['zq failed', failing()]);
        const meta = parsed.meta as { name: string; frames: string[] };
        expect(meta.name).toBe('TypeError');
        expect(Array.isArray(meta.frames)).toBe(true);
        expect(meta.frames.length).toBeGreaterThan(0);
        meta.frames.forEach((f) => expect(f).toMatch(/^\s*at /));
        expect(Object.keys(meta).sort()).toEqual(['frames', 'name']);
        expect(line).not.toContain(SECRET);
        expect(line).not.toContain('unexpected');
        expect(line).not.toContain('second');
      });

      it('is reduced inside nested values too', () => {
        const { line, parsed } = fmt(['zq', { wrapped: { err: failing() } }]);
        const { err } = (parsed.meta as { wrapped: { err: { name: string } } })
          .wrapped;
        expect(err.name).toBe('TypeError');
        expect(line).not.toContain(SECRET);
      });

      it('has no frames when it has no stack', () => {
        const e = failing();
        delete e.stack;
        const { parsed } = fmt(['zq', e]);
        expect(parsed.meta).toEqual({ name: 'TypeError', frames: [] });
      });
    });

    it('replaces a circular reference with "[circular]"', () => {
      const a: Record<string, unknown> = { n: 1 };
      a.self = a;
      const { parsed } = fmt(['zq', a]);
      expect(parsed.meta).toEqual({ n: 1, self: '[circular]' });
    });

    it('does not call a repeated, non-circular object circular', () => {
      const shared = { k: 1 };
      const { parsed } = fmt([
        'zq',
        { a: shared, b: shared, c: [shared, shared] },
      ]);
      expect(parsed.meta).toEqual({
        a: { k: 1 },
        b: { k: 1 },
        c: [{ k: 1 }, { k: 1 }],
      });
    });

    it('writes a bigint as its string', () => {
      const { parsed } = fmt(['zq', { big: 12345678901234567890n }]);
      expect(parsed.meta).toEqual({ big: '12345678901234567890' });
    });

    it('drops undefined and functions as JSON does', () => {
      const { parsed } = fmt(['zq', { u: undefined, f: () => 1, ok: 1 }]);
      expect(parsed.meta).toEqual({ ok: 1 });
    });

    it('falls back to a fixed line naming the error when a value cannot be serialised', () => {
      const bad = {
        toJSON: () => {
          throw new RangeError('SECRET detail');
        },
      };
      const { line, parsed } = fmt(['zq', bad]);
      expect(parsed).toEqual({
        ts: '2026-10-16T01:02:03.456Z',
        level: 'warn',
        source: 'main',
        msg: 'log entry could not be serialised',
        error: 'RangeError',
      });
      expect(line).not.toContain('SECRET');
    });

    it('falls back with the type when something other than an Error was thrown', () => {
      const bad = {
        toJSON: () => {
          // eslint-disable-next-line no-throw-literal
          throw 'a string';
        },
      };
      expect(fmt(['zq', bad], 'renderer').parsed).toMatchObject({
        msg: 'log entry could not be serialised',
        error: 'string',
        source: 'renderer',
      });
    });

    it('does not throw for an invalid or missing date', () => {
      const { mod } = load();
      const invalid = mod.formatRecord({
        ...record(['zq']),
        date: new Date(NaN),
      });
      expect(JSON.parse(invalid).msg).toBe('zq');
      const missing = mod.formatRecord({
        ...record(['zq']),
        date: undefined as unknown as Date,
      });
      expect(JSON.parse(missing).msg).toBe('zq');
    });

    it('every line of a mixed batch parses', () => {
      const circular: Record<string, unknown> = {};
      circular.c = circular;
      const batch: unknown[][] = [
        ['a'],
        ['b', { x: 1 }],
        ['c', new Error('m')],
        ['d', circular],
        ['e', 1n],
        [{ only: 'object' }],
        [],
        [
          'f',
          {
            toJSON: () => {
              throw new Error('x');
            },
          },
        ],
      ];
      const { mod } = load();
      batch.forEach((data) => {
        const line = mod.formatRecord(record(data));
        expect(() => JSON.parse(line)).not.toThrow();
        expect(line).not.toContain('\n');
      });
    });

    it('is installed as the file transport format, from the message', () => {
      const { log, mod } = load();
      const r = record(['zq', { n: 1 }], 'renderer');
      expect(log.transports.file.format({ message: r })).toEqual([
        mod.formatRecord(r),
      ]);
    });
  });

  // ---- rotation ----
  describe('rotateLogs', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-rotate-'));
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const main = () => path.join(dir, 'main.log');
    const archive = (n: number) => path.join(dir, `main.${n}.log`);
    // electron-log's file object, reduced to what rotation uses, over the real file system.
    const fakeFile = (p: string) => ({
      toString: () => p,
      clear: jest.fn(() => {
        fs.writeFileSync(p, '');
        return true;
      }),
      writeLine: jest.fn((text: string) => fs.appendFileSync(p, `${text}\n`)),
    });
    const records = () =>
      fs
        .readFileSync(main(), 'utf8')
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l));
    const names = () => fs.readdirSync(dir).sort();

    it('keeps exactly five archives after many rotations: newest is main.1.log, oldest dropped', () => {
      const { mod } = load();
      const report = jest.fn();
      for (let gen = 1; gen <= 8; gen += 1) {
        fs.writeFileSync(main(), `gen-${gen}`);
        mod.rotateLogs(fakeFile(main()), report);
      }
      expect(names()).toEqual([
        'main.1.log',
        'main.2.log',
        'main.3.log',
        'main.4.log',
        'main.5.log',
      ]);
      expect(fs.readFileSync(archive(1), 'utf8')).toBe('gen-8');
      expect(fs.readFileSync(archive(2), 'utf8')).toBe('gen-7');
      expect(fs.readFileSync(archive(5), 'utf8')).toBe('gen-4');
      expect(report).not.toHaveBeenCalled();
    });

    it('fills archives one at a time before any is dropped', () => {
      const { mod } = load();
      [1, 2, 3].forEach((gen) => {
        fs.writeFileSync(main(), `gen-${gen}`);
        mod.rotateLogs(fakeFile(main()), jest.fn());
      });
      expect(names()).toEqual(['main.1.log', 'main.2.log', 'main.3.log']);
      expect(fs.readFileSync(archive(3), 'utf8')).toBe('gen-1');
    });

    it('shifts across a gap in the archives', () => {
      const { mod } = load();
      fs.writeFileSync(archive(3), 'old-3');
      fs.writeFileSync(main(), 'now');
      mod.rotateLogs(fakeFile(main()), jest.fn());
      expect(names()).toEqual(['main.1.log', 'main.4.log']);
      expect(fs.readFileSync(archive(4), 'utf8')).toBe('old-3');
    });

    it('honours a different number to keep', () => {
      const { mod } = load();
      for (let gen = 1; gen <= 4; gen += 1) {
        fs.writeFileSync(main(), `gen-${gen}`);
        mod.rotateLogs(fakeFile(main()), jest.fn(), 2);
      }
      expect(names()).toEqual(['main.1.log', 'main.2.log']);
    });

    it('reports a rename that fails, crops, and throws nothing (log file missing)', () => {
      const { mod } = load();
      const report = jest.fn();
      const file = fakeFile(main());
      expect(() => mod.rotateLogs(file, report)).not.toThrow();
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(
        'Could not rotate log',
        expect.objectContaining({ code: 'ENOENT' })
      );
      // The missing file is replaced by one JSON line that says what happened.
      expect(records()).toEqual([
        expect.objectContaining({
          level: 'warn',
          source: 'main',
          msg: 'log rotation failed; earlier entries were dropped',
          meta: { error: 'Error', code: 'ENOENT', kept: 0 },
        }),
      ]);
    });

    it('reports a failure while shifting (the oldest slot is a non-empty folder), crops, and throws nothing', () => {
      const { mod } = load();
      fs.writeFileSync(main(), 'now');
      fs.writeFileSync(archive(1), 'one');
      fs.mkdirSync(archive(5));
      fs.writeFileSync(path.join(archive(5), 'inside'), 'x');
      const report = jest.fn();
      const file = fakeFile(main());
      expect(() => mod.rotateLogs(file, report)).not.toThrow();
      expect(report).toHaveBeenCalledWith(
        'Could not rotate log',
        expect.objectContaining({ code: 'ERR_FS_EISDIR' })
      );
      // Cropped, not lost: the marker, then the whole lines that were there.
      expect(fs.readFileSync(main(), 'utf8').split('\n')[1]).toBe('now');
      expect(
        JSON.parse(fs.readFileSync(main(), 'utf8').split('\n')[0])
      ).toEqual(
        expect.objectContaining({
          meta: { error: 'SystemError', code: 'ERR_FS_EISDIR', kept: 1 },
        })
      );
    });

    it('a crop keeps the tail from a whole line, and every line of the result is JSON', () => {
      const { mod } = load();
      const line = (i: number) =>
        JSON.stringify({ msg: `entry ${i}`, pad: 'x'.repeat(40) });
      const lines = Array.from({ length: 50 }, (_, i) => line(i));
      fs.writeFileSync(main(), `${lines.join('\n')}\n`);
      // A budget that ends in the middle of a line.
      const budget = Math.floor(line(0).length * 10.5);
      mod.cropToJsonl(fakeFile(main()), new Error('zq'), budget);
      const out = records();
      expect(out[0].msg).toBe(
        'log rotation failed; earlier entries were dropped'
      );
      const kept = out.slice(1).map((r) => r.msg);
      // Only whole lines, the newest ones, in order; the partial line at the cut is dropped.
      expect(kept).toEqual(
        lines.slice(50 - kept.length).map((l) => JSON.parse(l).msg)
      );
      expect(kept.length).toBe(10);
      expect(out[0].meta).toEqual({ error: 'Error', kept: 10 });
      expect(JSON.stringify(out)).not.toContain('zq');
    });

    it('a crop of a file smaller than the budget keeps every line', () => {
      const { mod } = load();
      fs.writeFileSync(main(), '{"a":1}\n{"b":2}\n');
      mod.cropToJsonl(fakeFile(main()), { code: 'not a code!' }, 1024);
      const out = records();
      expect(out.slice(1)).toEqual([{ a: 1 }, { b: 2 }]);
      // A code that is not a fixed token is left out.
      expect(out[0].meta).toEqual({ error: 'NonError', kept: 2 });
    });

    it('does not crop when every rename succeeds', () => {
      const { mod } = load();
      fs.writeFileSync(main(), 'now');
      const file = fakeFile(main());
      mod.rotateLogs(file, jest.fn());
      expect(file.clear).not.toHaveBeenCalled();
      expect(file.writeLine).not.toHaveBeenCalled();
    });

    it('is installed with a 5 MB limit, and a failure is reported on the console transport', () => {
      const { log } = load();
      expect(log.transports.file.maxSize).toBe(5 * 1024 * 1024);
      const file = fakeFile(main());
      log.transports.file.archiveLogFn(file);
      expect(file.clear).toHaveBeenCalledTimes(1);
      expect(log.transports.console).toHaveBeenCalledTimes(1);
      const msg = log.transports.console.mock.calls[0][0];
      expect(msg.level).toBe('warn');
      expect(msg.data[0]).toContain('Could not rotate log');
      expect(msg.data[1]).toEqual(expect.objectContaining({ code: 'ENOENT' }));
      expect(msg.date).toBeInstanceOf(Date);
    });

    it('rotates a real file through the installed hook', () => {
      const { log } = load();
      fs.writeFileSync(main(), 'now');
      log.transports.file.archiveLogFn(fakeFile(main()));
      expect(fs.readFileSync(archive(1), 'utf8')).toBe('now');
      expect(log.transports.console).not.toHaveBeenCalled();
    });
  });

  // ---- uncaught errors in the main process ----
  describe('registerUncaughtHandlers', () => {
    const SECRET = 'the quick brown fox';
    type Handler = (e: unknown) => void;
    const setup = (notify: (name: string) => void = jest.fn()) => {
      const handlers = new Map<string, Handler>();
      const proc = {
        on: (
          event: 'uncaughtException' | 'unhandledRejection',
          fn: Handler
        ) => {
          handlers.set(event, fn);
        },
      };
      const loaded = load();
      loaded.mod.registerUncaughtHandlers(proc, notify);
      return { ...loaded, handlers, notify };
    };

    it('registers both events', () => {
      const { handlers } = setup();
      expect([...handlers.keys()].sort()).toEqual([
        'uncaughtException',
        'unhandledRejection',
      ]);
    });

    it('an uncaught exception is logged as "uncaught error" with name and frames only, and the poet is told', () => {
      const { handlers, log, notify } = setup();
      handlers.get('uncaughtException')!(new RangeError(`bad ${SECRET}`));
      expect(log.error).toHaveBeenCalledTimes(1);
      const [msg, meta] = log.error.mock.calls[0];
      expect(msg).toBe('uncaught error');
      expect(meta).toEqual({ name: 'RangeError', frames: expect.any(Array) });
      expect(JSON.stringify(log.error.mock.calls)).not.toContain(SECRET);
      expect(notify).toHaveBeenCalledWith('RangeError');
    });

    // 0.5.0: a failed update check rejected, the handler called notify (a modal dialog), and the main
    // process blocked behind it: no poem opened at launch and SIGTERM went unhandled.
    it('an unhandled rejection is logged as "unhandled rejection" with name and frames only, and the poet is NOT interrupted', () => {
      const { handlers, log, notify } = setup();
      handlers.get('unhandledRejection')!(new RangeError(`bad ${SECRET}`));
      expect(log.error).toHaveBeenCalledTimes(1);
      const [msg, meta] = log.error.mock.calls[0];
      expect(msg).toBe('unhandled rejection');
      expect(meta).toEqual({ name: 'RangeError', frames: expect.any(Array) });
      expect(JSON.stringify(log.error.mock.calls)).not.toContain(SECRET);
      expect(notify).not.toHaveBeenCalled();
    });

    it('the entry written to the file has the message "uncaught error" and no message text', () => {
      const { handlers, log, mod } = setup();
      handlers.get('uncaughtException')!(new Error(`bad ${SECRET}`));
      const line = mod.formatRecord({
        date: new Date(),
        level: 'error',
        data: log.error.mock.calls[0],
      });
      const parsed = JSON.parse(line);
      expect(parsed).toMatchObject({
        level: 'error',
        source: 'main',
        msg: 'uncaught error',
      });
      expect(parsed.meta.name).toBe('Error');
      expect(line).not.toContain(SECRET);
    });

    it('logs a rejection that is not an Error without its content', () => {
      const { handlers, log, notify } = setup();
      handlers.get('unhandledRejection')!(`a string with ${SECRET}`);
      expect(log.error).toHaveBeenCalledWith('unhandled rejection', {
        name: 'NonError',
        frames: [],
      });
      expect(notify).not.toHaveBeenCalled();
    });

    it('logs, and does not throw, when telling the poet fails', () => {
      const { handlers, log } = setup(() => {
        throw new Error(`dialog ${SECRET}`);
      });
      expect(() =>
        handlers.get('uncaughtException')!(new Error('x'))
      ).not.toThrow();
      expect(log.error).toHaveBeenCalledTimes(2);
      expect(log.error.mock.calls[1][0]).toBe(
        'could not tell the user about an uncaught error'
      );
      expect(log.error.mock.calls[1][1]).toEqual({
        name: 'Error',
        frames: expect.any(Array),
      });
      expect(JSON.stringify(log.error.mock.calls)).not.toContain(SECRET);
    });
  });
});
