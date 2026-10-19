/**
 * @jest-environment node
 */
// tools/catalog-freshness.cjs: a build refuses a compiled catalog that is missing or older than its .po.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  staleCatalogs,
  assertCatalogsCompiled,
  CatalogFreshnessPlugin,
} = require('../catalog-freshness.cjs');

let root;
const at = (rel) => path.join(root, rel);
const write = (rel, mtimeSeconds) => {
  fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
  fs.writeFileSync(at(rel), '');
  fs.utimesSync(at(rel), mtimeSeconds, mtimeSeconds);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-fresh-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('staleCatalogs', () => {
  it('is empty when every compiled catalog is as new as its .po or newer', () => {
    write('locales/en/messages.po', 1000);
    write('locales/en/messages.ts', 1000);
    write('locales/fr/messages.po', 1000);
    write('locales/fr/messages.ts', 2000);
    expect(staleCatalogs(root)).toEqual([]);
  });

  it('names a missing compiled catalog', () => {
    write('locales/en/messages.po', 1000);
    expect(staleCatalogs(root)).toEqual([
      `${path.join('locales', 'en', 'messages.ts')} is missing.`,
    ]);
  });

  it('names a compiled catalog older than its .po, each language separately', () => {
    write('locales/en/messages.po', 1000);
    write('locales/en/messages.ts', 1000);
    write('locales/fr/messages.po', 2000);
    write('locales/fr/messages.ts', 1000);
    expect(staleCatalogs(root)).toEqual([
      `${path.join('locales', 'fr', 'messages.ts')} is older than ${path.join(
        'locales',
        'fr',
        'messages.po'
      )}.`,
    ]);
  });

  it('ignores a folder with no .po, such as a language that has only documents', () => {
    write('locales/en/messages.po', 1000);
    write('locales/en/messages.ts', 1000);
    write('locales/fr/docs/about.md', 1000);
    expect(staleCatalogs(root)).toEqual([]);
  });
});

describe('assertCatalogsCompiled and the webpack plugin', () => {
  it('throws, with the fix, when a catalog is stale, and returns when current', () => {
    write('locales/en/messages.po', 2000);
    write('locales/en/messages.ts', 1000);
    expect(() => assertCatalogsCompiled(root)).toThrow(
      /older than .* Run "npm run catalog:compile"\./
    );
    write('locales/en/messages.ts', 3000);
    expect(() => assertCatalogsCompiled(root)).not.toThrow();
  });

  it('checks when a compile starts, in a run and in watch mode, not when it is constructed', () => {
    write('locales/en/messages.po', 1000);
    const taps = {};
    const hook = (name) => ({
      tap: (_, fn) => {
        taps[name] = fn;
      },
    });
    const plugin = new CatalogFreshnessPlugin(root);
    plugin.apply({
      hooks: { beforeRun: hook('beforeRun'), watchRun: hook('watchRun') },
    });
    expect(taps.beforeRun).toThrow(/is missing/);
    expect(taps.watchRun).toThrow(/is missing/);
  });
});
