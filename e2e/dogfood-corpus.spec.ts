// Dogfooding the B -> C converter against the REAL editor, on the real archive.
//
// SKIPPED unless MIDST_DOGFOOD_MANIFEST is set, so CI never runs it and never needs the corpus. Run it
// through tools/dogfood_corpus.sh, which converts the archive into a temporary directory, builds the
// controls, writes the manifest, and deletes everything afterwards.
//
// NO POEM TEXT MAY LEAVE THIS SPEC. Poems are the poets' work (see DATA.md in midst-format), so:
//   - screenshots, traces and video are off: a screenshot of the editor IS the poem;
//   - every assertion compares a boolean; Playwright prints expected and received values on failure;
//   - results are written as JSON of ids, counts and booleans, and nothing else is printed;
//   - the app's log goes to the case's temp directory (MIDST_LOG_DIR), not ~/Library/Logs.
//
// Per case, the app is fed a COPY (opening can write to a file; see #12), and judged against the
// UNMUTATED conversion, so a mutated control copy must disagree with its expectation.
//
//   1  opens      no dialog, no renderer error, editor reachable
//   2t text       the editor's text equals the text of the conversion's `text`
//   2s structure  the editor's ProseMirror document equals the app's own parse of that `text`
//                 (marks and block boundaries, which plain text cannot see)
//   3  history    the renderer's poemHistory, and the store's, equal the conversion's `history`
//   4  unchanged  the copy on disk is byte-identical after the settle window AND after the app closes

import { test, expect } from '@playwright/test';
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { _electron as electron } from 'playwright';
import {
  APP_DIR,
  SETTLE_MS,
  seedStore,
  captureDialogs,
  dialogsSeen,
  openDocument,
  readStore,
} from './harness';

interface Case {
  id: string; // P01..Pnn for poems, C-<kind> for controls. Never a title.
  feed: string; // the file the app is given (a copy of it)
  expected: string; // the unmutated conversion it is judged against
  mustFail: boolean;
}
interface Manifest {
  work: string;
  results: string;
  cases: Case[];
}

const MANIFEST = process.env.MIDST_DOGFOOD_MANIFEST;
const manifest: Manifest | null = MANIFEST
  ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
  : null;

test.use({ screenshot: 'off', trace: 'off', video: 'off' });
// Not serial: one poem's failure must not skip the rest. The config already runs one worker.

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])])
    );
  }
  return v;
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const canonHash = (v: unknown) => sha(JSON.stringify(sortKeys(v)));
const parseMidst = (raw: string) =>
  JSON.parse(raw.split('\n')[1]) as { text: string; history: unknown[] };

const cases = manifest?.cases ?? [];
test.skip(!manifest, 'MIDST_DOGFOOD_MANIFEST is not set');

cases.forEach((c) => {
  test(`dogfood ${c.id}`, async () => {
    test.setTimeout(240_000);
    const m = manifest as Manifest;
    const work = mkdtempSync(join(m.work, 'case-'));
    const copy = join(work, 'poem.midst');
    copyFileSync(c.feed, copy);
    const before = sha(readFileSync(copy, 'utf8'));
    const expected = parseMidst(readFileSync(c.expected, 'utf8'));

    const userData = join(work, 'userdata');
    seedStore(userData);
    const app = await electron.launch({
      args: [APP_DIR, `--user-data-dir=${userData}`],
      env: { ...process.env, MIDST_LOG_DIR: work } as Record<string, string>,
      timeout: 60_000,
    });
    let rendererErrors = 0;
    const r: Record<string, unknown> = { id: c.id, mustFail: c.mustFail };
    try {
      await captureDialogs(app);
      const win = await app.firstWindow();
      win.on('pageerror', () => {
        rendererErrors += 1;
      });
      win.on('console', (msg) => {
        if (msg.type() === 'error') rendererErrors += 1;
      });
      await win.waitForLoadState('domcontentloaded');
      await openDocument(app, userData, copy, c.id);
      await win
        .locator('.ProseMirror')
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 });

      const seen = await win.evaluate((html: string) => {
        type Ed = {
          schema: {
            cached: Record<string, unknown>;
          };
          options: { parseOptions?: unknown };
          getJSON: () => unknown;
          state: { doc: { textContent: string } };
        };
        /* eslint-disable no-unused-vars */
        type Parser = {
          // The base rule misreads a function TYPE's parameter names as unused bindings (as in
          // src/renderer/preload.d.ts).
          parse: (
            node: Node,
            options?: unknown
          ) => {
            toJSON: () => unknown;
            textContent: string;
          };
        };
        /* eslint-enable no-unused-vars */
        const el = document.querySelector('.ProseMirror') as
          | (Element & { editor?: Ed })
          | null;
        const ed = el?.editor;
        if (!el || !ed) return { reach: false };
        const { domParser } = ed.schema.cached;
        const parser = domParser as Parser | undefined;
        let expDoc: unknown = null;
        let expText: string | null = null;
        if (parser) {
          // An inert document: nothing in the poem's HTML can execute while it is parsed.
          const { body } = new window.DOMParser().parseFromString(
            html,
            'text/html'
          );
          const d = parser.parse(body, ed.options.parseOptions);
          expDoc = d.toJSON();
          expText = d.textContent;
        }
        // The renderer's own poemHistory, from the HistoryContext provider above the editor. TipTap
        // creates .ProseMirror itself, so it carries no React fiber: start from the nearest ancestor
        // React rendered, then walk up the fiber tree.
        let history: unknown = null;
        let host: Element | null = el;
        let key: string | undefined;
        while (host && !key) {
          key = Object.keys(host).find((k) => k.startsWith('__reactFiber$'));
          if (!key) host = host.parentElement;
        }
        let f =
          host && key
            ? (host as unknown as Record<string, unknown>)[key]
            : null;
        while (f) {
          const fiber = f as {
            memoizedProps?: { value?: { poemHistory?: unknown } };
            return?: unknown;
          };
          const v = fiber.memoizedProps?.value;
          if (v && Array.isArray(v.poemHistory)) {
            history = v.poemHistory;
            break;
          }
          f = fiber.return ?? null;
        }
        return {
          reach: true,
          parser: !!parser,
          appDoc: ed.getJSON(),
          expDoc,
          appText: ed.state.doc.textContent,
          expText,
          history,
        };
      }, expected.text);

      await new Promise((resolve) => {
        setTimeout(resolve, SETTLE_MS);
      });
      const afterSettle = sha(readFileSync(copy, 'utf8'));
      const storeRaw = readStore(userData).history;
      const dialogs = (await dialogsSeen(app)).length;
      const expHist = canonHash(expected.history);

      r.frames = expected.history.length;
      r.dialogs = dialogs;
      r.opens = seen.reach === true && dialogs === 0;
      r.text =
        seen.reach === true &&
        seen.expText !== null &&
        sha(seen.appText as string) === sha(seen.expText as string);
      r.structure =
        seen.reach === true &&
        seen.parser === true &&
        canonHash(seen.appDoc) === canonHash(seen.expDoc);
      r.historyReachable = seen.reach === true && Array.isArray(seen.history);
      r.history =
        r.historyReachable === true && canonHash(seen.history) === expHist;
      r.storeHistory =
        typeof storeRaw === 'string' &&
        canonHash(JSON.parse(storeRaw)) === expHist;
      r.unchangedAfterSettle = afterSettle === before;
    } finally {
      await app.close();
    }
    r.unchangedAfterClose = sha(readFileSync(copy, 'utf8')) === before;
    r.rendererErrors = rendererErrors;
    r.opens = r.opens === true && rendererErrors === 0;
    r.pass = [
      'opens',
      'text',
      'structure',
      'history',
      'storeHistory',
      'unchangedAfterSettle',
      'unchangedAfterClose',
    ].every((k) => r[k] === true);
    appendFileSync(m.results, `${JSON.stringify(r)}\n`);

    // A boolean, and a message carrying only the id: nothing a failure prints can contain the poem.
    expect(r.pass, `${c.id}: pass=${r.pass}, expected ${!c.mustFail}`).toBe(
      !c.mustFail
    );
  });
});
