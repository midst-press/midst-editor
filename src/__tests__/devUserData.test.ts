import { readFileSync } from 'fs';
import path from 'path';

jest.mock('electron', () => ({
  app: {
    isPackaged: true,
    commandLine: { hasSwitch: () => false },
    getPath: () => '/zq-appdata',
    setPath: jest.fn(),
  },
}));

// eslint-disable-next-line import/first
import { DEV_FOLDER, separateDevState } from '../main/devUserData';

const APPDATA = '/Users/zq/Library/Application Support';
const fakeApp = ({
  packaged = false,
  userDataSwitch = false,
}: { packaged?: boolean; userDataSwitch?: boolean } = {}) => ({
  isPackaged: packaged,
  commandLine: { hasSwitch: jest.fn(() => userDataSwitch) },
  getPath: jest.fn(() => APPDATA),
  setPath: jest.fn(),
});

describe('separateDevState', () => {
  it('a development build gets its own store and log folder', () => {
    const a = fakeApp();
    const env: NodeJS.ProcessEnv = {};
    const changed = separateDevState(a, env);
    const base = path.join(APPDATA, DEV_FOLDER);
    expect(a.setPath).toHaveBeenCalledWith('userData', base);
    expect(env.MIDST_LOG_DIR).toBe(path.join(base, 'logs'));
    expect(changed).toEqual({
      userData: base,
      logDir: path.join(base, 'logs'),
    });
  });

  // The defect: "midst" and "Midst" are one folder on a case-insensitive disk.
  it("the development folder is not the installed app's, even ignoring case", () => {
    const a = fakeApp();
    separateDevState(a, {});
    const [, dir] = a.setPath.mock.calls[0];
    expect(dir.toLowerCase()).not.toBe(
      path.join(APPDATA, 'Midst').toLowerCase()
    );
    expect(dir.toLowerCase()).not.toBe(
      path.join(APPDATA, 'midst').toLowerCase()
    );
  });

  it('a packaged app is left alone', () => {
    const a = fakeApp({ packaged: true });
    const env: NodeJS.ProcessEnv = {};
    expect(separateDevState(a, env)).toEqual({});
    expect(a.setPath).not.toHaveBeenCalled();
    expect(env.MIDST_LOG_DIR).toBeUndefined();
  });

  it('a launch that names its own user-data folder keeps it (the e2e specs do)', () => {
    const a = fakeApp({ userDataSwitch: true });
    separateDevState(a, {});
    expect(a.commandLine.hasSwitch).toHaveBeenCalledWith('user-data-dir');
    expect(a.setPath).not.toHaveBeenCalled();
  });

  it('a launch that names its own log folder keeps it', () => {
    const env: NodeJS.ProcessEnv = { MIDST_LOG_DIR: '/zq-logs' };
    separateDevState(fakeApp(), env);
    expect(env.MIDST_LOG_DIR).toBe('/zq-logs');
  });

  // Load-bearing order: store.ts opens the store, and logging.ts reads MIDST_LOG_DIR, when imported.
  it("is main.ts's first import, ahead of the store and the log", () => {
    const source = readFileSync(
      path.join(__dirname, '../main/main.ts'),
      'utf8'
    );
    const imports = [...source.matchAll(/^import\s.*?['"](.+?)['"];?$/gms)].map(
      (m) => m[1]
    );
    expect(imports[0]).toBe('./devUserData');
  });
});
