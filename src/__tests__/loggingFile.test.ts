/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';

// The real electron-log file transport, writing to a temporary directory: what logging.ts installs is
// exercised through the library, not through a mock of it. Synthetic values only.
describe('logging.ts through the real electron-log file transport', () => {
  let dir: string;
  let log: typeof import('electron-log').default;
  const saved = process.env.MIDST_LOG_DIR;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-logfile-'));
    process.env.MIDST_LOG_DIR = dir;
    jest.isolateModules(() => {
      /* eslint-disable global-require */
      jest.doMock('../main/store', () => ({
        __esModule: true,
        default: { get: () => undefined, set: () => undefined },
      }));
      log = require('electron-log').default;
      require('../main/logging');
      /* eslint-enable global-require */
    });
    log.transports.console.level = false;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MIDST_LOG_DIR;
    else process.env.MIDST_LOG_DIR = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const lines = (name = 'main.log') =>
    fs
      .readFileSync(path.join(dir, name), 'utf8')
      .split('\n')
      .filter((l) => l !== '');

  it('writes one JSON object per line, main and renderer marked by source', () => {
    const rendererLog = log.scope('renderer');
    log.info('zq started', { n: 1 });
    log.error('with percent %s and %d', { a: 'b' });
    rendererLog.error('draft marker change refused', { reason: 'xv' });
    log.warn(new Error('SECRET words'));
    const records = lines().map((l) => JSON.parse(l));
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({
      level: 'info',
      source: 'main',
      msg: 'zq started',
      meta: { n: 1 },
    });
    expect(records[1].msg).toBe('with percent %s and %d');
    expect(records[2]).toMatchObject({
      level: 'error',
      source: 'renderer',
      msg: 'draft marker change refused',
      meta: { reason: 'xv' },
    });
    expect(records[3].msg).toBe('');
    expect(records[3].meta.name).toBe('Error');
    expect(lines().join('\n')).not.toContain('SECRET');
  });

  it('keeps the argument after a "%c" in a message (electron-log drops it as a style before formatting)', () => {
    log.warn('zq %c xv', 'qz');
    expect(lines().map((l) => JSON.parse(l))).toEqual([
      expect.objectContaining({ msg: 'zq %c xv', meta: 'qz' }),
    ]);
  });

  it('rotates at maxSize into main.1.log ... main.5.log, every line in every file parses', () => {
    log.transports.file.maxSize = 400;
    for (let i = 0; i < 120; i += 1) log.info(`entry ${i}`, { i });
    const names = fs.readdirSync(dir).sort();
    expect(names).toEqual([
      'main.1.log',
      'main.2.log',
      'main.3.log',
      'main.4.log',
      'main.5.log',
      'main.log',
    ]);
    names.forEach((name) =>
      lines(name).forEach((l) => expect(() => JSON.parse(l)).not.toThrow())
    );
    // Newest content is in main.log, then main.1.log: entry numbers fall as the archive number rises.
    const lastOf = (name: string) =>
      JSON.parse(lines(name).slice(-1)[0]).meta.i as number;
    const order = [
      'main.log',
      'main.1.log',
      'main.2.log',
      'main.3.log',
      'main.4.log',
      'main.5.log',
    ].map(lastOf);
    expect(order[0]).toBe(119);
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });
});
