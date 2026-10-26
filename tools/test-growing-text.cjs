// Checks the measurement driver's API contract with a model, not a substitute for an Electron run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const specSource = fs.readFileSync(path.join(root, 'e2e/growing-text.spec.ts'), 'utf8');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixtures() {
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'e2e/fixtures.ts'), 'utf8')), {
    exports,
    require: () => ({ compareStrings() { throw new Error('unexpected playable fixture'); } }),
  });
  return exports;
}

function expect(actual, message) {
  return {
    toBe: (wanted) => assert.equal(actual, wanted, message),
    toEqual: (wanted) => assert.equal(JSON.stringify(actual), JSON.stringify(wanted), message),
    toBeGreaterThan: (wanted) => assert.ok(actual > wanted, message),
    toBeVisible: async () => assert.ok(actual, message),
  };
}

async function modeledRun({ maxPrefix = 3, budget = 30000, brokenBackspace = false, corruptSave = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'growing-text-model-'));
  const result = path.join(dir, 'model-only.json');
  const keys = [];
  let text = '';
  let documentPath;
  let clock = 0;
  let callback;
  let skip;
  const history = [];
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  const editor = { textContent: async () => text, click: async () => {} };
  const win = {
    on() {},
    async waitForLoadState() {},
    locator: () => editor,
    keyboard: {
      async press(key) {
        keys.push(key);
        if (key === 'Backspace') {
          if (brokenBackspace) return;
          text = text.slice(0, -1);
        } else {
          assert.match(key, /^[a-z]$/);
          text += key;
        }
        history.push({ modelOnly: true });
      },
    },
    async waitForFunction(_predicate, wanted) {
      assert.equal(text, wanted, 'model DOM acknowledgment disagreed');
    },
  };
  const app = Object.assign(new EventEmitter(), {
    process: () => child,
    evaluate: async (fn) => fn({ app: { getVersion: () => 'model-only' } }),
    firstWindow: async () => win,
    async close() {
      child.exitCode = 0;
      child.emit('exit', 0);
      app.emit('close');
    },
  });
  const harness = {
    launch: async () => ({ app, userData: path.join(dir, 'model-profile') }),
    async openDocument(_app, _profile, file) { documentPath = file; },
    async clickMenuItem(_app, id) {
      assert.equal(id, 'menu.file.save');
      fs.writeFileSync(documentPath, `midstVersion: 1\n${JSON.stringify({
        text: `<p>${text}</p>`, history: corruptSave ? history.slice(1) : history,
      })}`);
    },
    waitUntil: async (predicate) => predicate(),
  };
  const testApi = (_name, fn) => { callback = fn; };
  testApi.skip = (condition) => { skip = condition; };
  testApi.setTimeout = () => {};
  const context = {
    exports: {},
    __dirname: path.join(root, 'e2e'),
    process: {
      env: {
        MIDST_GROWING_TEXT_RESULT: result,
        MIDST_GROWING_TEXT_MAX_PREFIX: String(maxPrefix),
        MIDST_GROWING_TEXT_BUDGET_MS: String(budget),
      },
      versions: { electron: 'model-only' },
    },
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === '@playwright/test') return { test: testApi, expect };
      if (name === './harness') return harness;
      if (name === './fixtures') return fixtures();
      if (name === 'perf_hooks') return { performance: { now: () => clock++ } };
      if (['fs', 'os', 'path'].includes(name)) return require(name);
      throw new Error(`unexpected driver import ${name}`);
    },
  };
  vm.runInNewContext(compile(specSource), context);
  assert.equal(skip, false);
  let error;
  try { await callback(); } catch (caught) { error = caught; }
  return { report: JSON.parse(fs.readFileSync(result, 'utf8')), keys, error, result, callback };
}

test('driver performs a/delete, ab/delete, abc/delete and verifies saved history', async () => {
  const run = await modeledRun();
  assert.ifError(run.error);
  assert.deepEqual(run.keys, ['a', 'Backspace', 'a', 'b', 'Backspace', 'Backspace', 'a', 'b', 'c', 'Backspace', 'Backspace', 'Backspace']);
  assert.equal(run.report.maximumCompletedPrefix, 3);
  assert.equal(run.report.savedHistoryLength, 12);
  assert.equal(run.report.confirmedKeyEvents, 12);
  assert.equal(run.report.outcome, 'prefix_cap');
  assert.equal(run.report.appVersion, 'model-only');
  const before = fs.readFileSync(run.result);
  await assert.rejects(run.callback, { code: 'EEXIST' });
  assert.deepEqual(fs.readFileSync(run.result), before);
});

test('alphabet wraps after z and each complete cycle accounts for n(n+1) keystrokes', async () => {
  const run = await modeledRun({ maxPrefix: 28 });
  assert.ifError(run.error);
  assert.equal(run.report.maximumCompletedPrefix, 28);
  assert.equal(run.report.savedHistoryLength, 28 * 29);
  assert.equal(run.keys.slice(27 * 28, 27 * 28 + 28).join(''), 'abcdefghijklmnopqrstuvwxyza' + 'b');
});

test('virtual time budget reports a partial bound instead of an application limit', async () => {
  const run = await modeledRun({ maxPrefix: 1000, budget: 45 });
  assert.ifError(run.error);
  assert.equal(run.report.outcome, 'time_budget');
  assert.ok(run.report.maximumCompletedPrefix > 0 && run.report.maximumCompletedPrefix < 1000);
  assert.ok(run.report.savedHistoryLength >= run.report.confirmedKeyEvents);
  assert.ok(run.report.savedHistoryLength <= run.report.attemptedKeyEvents);
});

test('a broken backspace produces the driver-specific DOM failure', async () => {
  const run = await modeledRun({ brokenBackspace: true });
  assert.match(String(run.error), /model DOM acknowledgment disagreed/);
  assert.equal(run.report.outcome, 'failure');
  assert.equal(run.report.failure.phase, 'backspace');
  assert.equal(run.report.maximumCompletedPrefix, 0);
});

test('missing saved history fails independently of successful typing', async () => {
  const run = await modeledRun({ corruptSave: true });
  assert.match(String(run.error), /saved text\/history do not account/);
  assert.equal(run.report.failure.phase, 'save-and-verify');
  assert.equal(run.report.maximumCompletedPrefix, 3);
});

test('installer forwards an isolated cache path and preserves the default', async () => {
  const source = fs.readFileSync(path.join(root, 'tools/install-electron.cjs'), 'utf8');
  for (const cache of [undefined, '/synthetic/scoped-cache']) {
    let requested;
    let exitCode;
    const load = (name) => {
      if (name === 'path') return path;
      if (name === 'fs') return { readFileSync() { throw new Error('not installed'); } };
      if (name === 'child_process') return { execFileSync() { throw new Error('unexpected unpack'); } };
      if (name === '/synthetic/electron/package.json') return { version: '1.2.3' };
      if (name === '/synthetic/electron/checksums.json') return {};
      if (name === '/synthetic/get') return { async downloadArtifact(details) { requested = details; throw new Error('probe stops before filesystem changes'); } };
      throw new Error(`unexpected installer import ${name}`);
    };
    load.resolve = (name) => name === 'electron/package.json' ? '/synthetic/electron/package.json' : '/synthetic/get';
    await vm.runInNewContext(source, {
      require: load,
      process: { platform: 'darwin', arch: 'arm64', env: cache ? { ELECTRON_CACHE: cache } : {}, exit(code) { exitCode = code; } },
      console: { log() {}, error() {} },
    });
    assert.equal(exitCode, 1);
    assert.equal(requested.cacheRoot, cache);
  }
});
