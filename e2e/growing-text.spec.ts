/* eslint-disable no-await-in-loop, no-restricted-syntax -- each real keystroke must be observed before sending the next */
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { arch, hostname, platform, tmpdir } from 'os';
import { dirname, join } from 'path';
import { performance } from 'perf_hooks';
import { makeMidst, parseMidst } from './fixtures';
import { clickMenuItem, launch, openDocument, waitUntil } from './harness';

// Annelyse's pattern in GitHub midst-editor#34: a/delete, ab/delete, abc/delete, wrapping after z.
// Opt-in: MIDST_GROWING_TEXT_RESULT=/new/path/result.json npm run e2e -- e2e/growing-text.spec.ts
// A budget stop measures a lower bound, not a text/history limit. Files and the profile are retained.
test.skip(
  !process.env.MIDST_GROWING_TEXT_RESULT,
  'set MIDST_GROWING_TEXT_RESULT to run the growing type/backspace measurement'
);

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

class BudgetExpired extends Error {}

test('growing alphabet prefixes are typed and backspaced through real editor events', async () => {
  const budgetMs = positiveInteger('MIDST_GROWING_TEXT_BUDGET_MS', 60_000);
  const maxPrefix = positiveInteger('MIDST_GROWING_TEXT_MAX_PREFIX', 10_000);
  test.setTimeout(budgetMs + 180_000);
  const resultPath = process.env.MIDST_GROWING_TEXT_RESULT!;
  mkdirSync(dirname(resultPath), { recursive: true });
  // Refuse an existing result instead of replacing a previous measurement.
  const resultFd = openSync(resultPath, 'wx');
  let work = '';
  let documentPath = '';
  const journalPath = `${resultPath}.cycles.jsonl`;
  let journalFd: number | undefined;
  let app: ElectronApplication | undefined;
  let ownedProcess: ReturnType<ElectronApplication['process']> | undefined;
  let failure: unknown;
  let closing = false;
  let inputDeadline = Infinity;
  let phase = 'setup';
  let prefix = 0;
  let started = 0;
  const errors: string[] = [];
  const report = {
    pattern:
      'type alphabet prefix of length n, then backspace n times; n grows by one',
    host: hostname(),
    platform: platform(),
    arch: arch(),
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    appVersion: null as string | null,
    budgetMs,
    maxPrefix,
    work,
    outcome: 'setup_failure',
    maximumVerifiedPrefix: 0,
    maximumCompletedPrefix: 0,
    attemptedKeyEvents: 0,
    confirmedKeyEvents: 0,
    inputElapsedMs: 0,
    finalTextLength: null as number | null,
    savedHistoryLength: null as number | null,
    savedFileBytes: null as number | null,
    mainPid: null as number | null,
    mainExited: null as boolean | null,
    versions: {} as Record<string, string | undefined>,
    errors,
    failure: null as Record<string, unknown> | null,
  };

  // Includes Playwright/CDP round trips and DOM verification; this is not compositor/paint timing.
  async function observed<T>(operation: () => Promise<T>): Promise<T> {
    const remaining = inputDeadline - performance.now();
    if (remaining <= 0) throw new BudgetExpired();
    const atBudget = remaining <= 10_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                atBudget
                  ? new BudgetExpired()
                  : new Error(
                      `${phase}: operation did not complete within 10 seconds`
                    )
              ),
            Math.min(remaining, 10_000)
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    work = mkdtempSync(join(tmpdir(), 'midst-growing-text-'));
    documentPath = join(work, 'synthetic-alphabet.midst');
    report.work = work;
    journalFd = openSync(journalPath, 'wx');
    writeFileSync(documentPath, makeMidst('', 0).file, { flag: 'wx' });
    const launched = await launch(work);
    app = launched.app;
    ownedProcess = app.process();
    report.mainPid = ownedProcess.pid ?? null;
    ownedProcess.once('exit', () => {
      report.mainExited = true;
    });
    app.on('close', () => {
      if (!closing) errors.push('Electron main process closed during the run');
    });
    report.versions = await app.evaluate(() => ({ ...process.versions }));
    report.appVersion = await app.evaluate(({ app: instance }) =>
      instance.getVersion()
    );
    const win = await app.firstWindow();
    win.on('crash', () => errors.push('renderer crash'));
    win.on('pageerror', (error) => errors.push(error.message));
    await win.waitForLoadState('domcontentloaded');
    await openDocument(
      app,
      launched.userData,
      documentPath,
      'the synthetic empty document'
    );
    const editor = win.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    expect(await editor.textContent()).toBe('');
    await editor.click();

    started = performance.now();
    inputDeadline = started + budgetMs;
    report.outcome = 'prefix_cap';
    try {
      for (prefix = 1; prefix <= maxPrefix; prefix += 1) {
        const expected = Array.from({ length: prefix }, (_, i) =>
          String.fromCharCode(97 + (i % 26))
        ).join('');
        const cycleStarted = performance.now();
        let current = '';
        phase = 'type';
        for (const letter of expected) {
          await observed(() => {
            report.attemptedKeyEvents += 1;
            return win.keyboard.press(letter);
          });
          current += letter;
          const currentText = current;
          await observed(() =>
            win.waitForFunction(
              (text) =>
                document.querySelector('.ProseMirror')?.textContent === text,
              currentText,
              { timeout: 0, polling: 5 }
            )
          );
          report.confirmedKeyEvents += 1;
        }
        report.maximumVerifiedPrefix = prefix;
        const typedAt = performance.now();
        phase = 'backspace';
        for (let length = prefix - 1; length >= 0; length -= 1) {
          await observed(() => {
            report.attemptedKeyEvents += 1;
            return win.keyboard.press('Backspace');
          });
          await observed(() =>
            win.waitForFunction(
              (text) =>
                document.querySelector('.ProseMirror')?.textContent === text,
              expected.slice(0, length),
              { timeout: 0, polling: 5 }
            )
          );
          report.confirmedKeyEvents += 1;
        }
        report.maximumCompletedPrefix = prefix;
        writeFileSync(
          journalFd,
          `${JSON.stringify({
            prefixLength: prefix,
            typedMs: typedAt - cycleStarted,
            backspacedMs: performance.now() - typedAt,
            elapsedMs: performance.now() - started,
            confirmedKeyEvents: report.confirmedKeyEvents,
          })}\n`
        );
      }
    } catch (error) {
      if (!(error instanceof BudgetExpired)) throw error;
      report.outcome = 'time_budget';
    } finally {
      report.inputElapsedMs = performance.now() - started;
      inputDeadline = Infinity;
    }

    phase = 'save-and-verify';
    expect(
      report.maximumCompletedPrefix,
      'no complete cycle was exercised'
    ).toBeGreaterThan(0);
    const finalText = (await observed(() => editor.textContent())) ?? '';
    report.finalTextLength = finalText.length;
    await observed(() => clickMenuItem(app!, 'menu.file.save'));
    const saved = await waitUntil(() => {
      try {
        const document = parseMidst(readFileSync(documentPath, 'utf8'));
        return (
          document.text === `<p>${finalText}</p>` &&
          document.history.length >= report.confirmedKeyEvents &&
          document.history.length <= report.attemptedKeyEvents
        );
      } catch {
        return false;
      }
    }, 30_000);
    expect(
      saved,
      'saved text/history do not account for the observed keystrokes'
    ).toBe(true);
    const savedDocument = parseMidst(readFileSync(documentPath, 'utf8'));
    report.savedHistoryLength = savedDocument.history.length;
    report.savedFileBytes = statSync(documentPath).size;
    expect(errors, 'Electron reported a crash or renderer error').toEqual([]);
  } catch (error) {
    failure = error;
    report.outcome = 'failure';
    report.failure = {
      phase,
      prefix,
      message: String((error as Error).message ?? error),
    };
  } finally {
    closing = true;
    try {
      if (app) {
        try {
          await observed(() => app!.close());
        } catch (error) {
          errors.push(`app.close failed: ${String(error)}`);
          failure ??= error;
        }
      }
      // Playwright disposes app.process() during close; this launch-owned handle remains usable.
      if (ownedProcess) {
        const exited = () =>
          ownedProcess!.exitCode !== null || ownedProcess!.signalCode !== null;
        report.mainExited = await waitUntil(exited, 10_000);
        if (!report.mainExited) {
          try {
            ownedProcess.kill('SIGTERM');
          } catch (error) {
            errors.push(`owned process SIGTERM failed: ${String(error)}`);
            failure ??= error;
          }
          report.mainExited = await waitUntil(exited, 10_000);
        }
      }
    } catch (error) {
      errors.push(`teardown failed: ${String(error)}`);
      failure ??= error;
    } finally {
      try {
        if (journalFd !== undefined) closeSync(journalFd);
      } catch (error) {
        errors.push(`journal close failed: ${String(error)}`);
        failure ??= error;
      }
      if (errors.length && !failure) failure = new Error(errors.join(' | '));
      if (ownedProcess && !report.mainExited && !failure)
        failure = new Error('the owned Electron main process has not exited');
      if (failure && report.outcome !== 'failure') {
        report.outcome = 'failure';
        report.failure = { phase: 'close', prefix, message: String(failure) };
      }
      report.finishedAt = new Date().toISOString();
      try {
        writeFileSync(resultFd, `${JSON.stringify(report, null, 2)}\n`);
      } finally {
        closeSync(resultFd);
      }
    }
  }
  if (failure) throw failure;
});
