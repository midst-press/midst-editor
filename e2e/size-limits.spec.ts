/* eslint-disable no-underscore-dangle, no-restricted-syntax, no-await-in-loop -- a measurement script: in-page globals, ordered steps */
import { test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeSync,
  constants,
  copyFileSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { dialogsSeen, launch } from './harness';

// SIZE LIMITS (midst-editor #34): how long a poem the editor copes with. Opt-in and run by hand, never by CI:
// with MIDST_SIZE_FILE unset the whole file is skipped. tools/size_search.mjs in midst-format drives it over
// generated poems of halving length.
//
//   MIDST_SIZE_FILE=/path/poem.midst MIDST_SIZE_RESULT=/path/result.json npx playwright test e2e/size-limits.spec.ts
//
// It measures and writes ONE JSON object to MIDST_SIZE_RESULT; the thresholds are applied by the driver, not here.
// The file is cloned (copy-on-write where the volume allows) before the app opens it, so the original is untouched
// by the autosave. Every step has a generous timeout: a slow but alive app gives a number, a step that exceeds its
// timeout records the timeout as its value and a failure.
//
// WHAT THE TIMESTAMPS BRACKET. Typing: from the keydown event's own timeStamp (taken when the browser process made
// the event, so time spent queued behind a busy renderer counts) to the first DOM mutation that lengthens the last
// paragraph ("dom"), and to the first timer after the next animation frame ("screen", an approximation of paint:
// no GPU or compositor timing). Not included: the OS and Playwright's CDP delivery of the key. Save: from the main
// process receiving 'save-file' to the last change of the file's size or mtime seen by a 10 ms stat poll, after
// the file has then stayed unchanged for SAVE_QUIET_MS. The renderer's work BEFORE that message (serialising the
// history into the store) is reported separately as `prepMs`.

test.skip(
  !process.env.MIDST_SIZE_FILE,
  'size-limit measurement is opt-in: set MIDST_SIZE_FILE and MIDST_SIZE_RESULT'
);

const OPEN_TIMEOUT = 120_000;
const KEY_TIMEOUT = 60_000;
const SAVE_TIMEOUT = Number(process.env.MIDST_SIZE_SAVE_TIMEOUT ?? 180_000);
const SAVE_QUIET_MS = 2_000;
const REPLAY_TIMEOUT = 120_000;
const SLIDER_TIMEOUT = 60_000;
const PLAY_SECONDS = 6;
// usePlayback.ts FRAME_MS: one frame of the history every 60 ms.
const SET_FPS = 1000 / 60;
const KEYS = 100;
const SLIDER_POSITIONS = [0.5, 0.1, 0.9, 0.3, 0.7, 0.2];
const TYPED =
  'the quick brown fox jumps over the lazy dog while a small rain keeps falling on the roof and the lamp burns low ';

type Failure = { step: string; reason: string };
type Dist = { n: number; p50: number; p95: number; max: number };

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// Rejects after `ms` unless `p` settles first; the timer is cleared either way, so no rejection is left unobserved.
async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(what)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const dist = (xs: number[]): Dist => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) =>
    s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : NaN;
  return {
    n: s.length,
    p50: at(0.5),
    p95: at(0.95),
    max: s.length ? s[s.length - 1] : NaN,
  };
};

// The poem's last paragraph's last 30 characters, read from the head of the file (the JSON writes `text` first,
// so the whole 1 GB history need not be parsed here).
function lastTail(file: string): { tail: string; chars: number } {
  const fd = openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    const parts: Buffer[] = [];
    let seen = '';
    let pos = 0;
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, pos);
      if (n === 0) throw new Error('no "history" key found in the file');
      pos += n;
      parts.push(Buffer.from(chunk.subarray(0, n)));
      seen += chunk.toString('latin1', 0, n); // latin1 keeps one character per byte, so offsets are byte offsets
      const k = seen.indexOf('","history":');
      if (k !== -1) {
        const bytes = Buffer.concat(parts);
        const start = seen.indexOf('{');
        const text = JSON.parse(
          `${bytes.subarray(start, k + 1).toString('utf8')}}`
        ).text as string;
        const plain = text
          .split('</p>')
          .map((p) =>
            p
              .replace(/<[^>]*>/g, '')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&amp;/g, '&')
          )
          .filter((p) => p.length > 0);
        const last = plain[plain.length - 1] ?? '';
        return { tail: last.slice(-30), chars: plain.join('').length };
      }
    }
  } finally {
    closeSync(fd);
  }
}

test('size limits: open, type, save, replay', async () => {
  test.setTimeout(60 * 60_000);
  const FILE = process.env.MIDST_SIZE_FILE as string;
  const RESULT = process.env.MIDST_SIZE_RESULT;
  if (!RESULT)
    throw new Error(
      'MIDST_SIZE_RESULT is not set: nowhere to write the measurements'
    );
  mkdirSync(dirname(RESULT), { recursive: true });

  const work = join(dirname(RESULT), `editor-work-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const poem = join(work, 'size.midst');
  copyFileSync(FILE, poem, constants.COPYFILE_FICLONE);
  const fileBytes = statSync(poem).size;
  const { tail, chars } = lastTail(poem);

  const failures: Failure[] = [];
  const m: Record<string, unknown> = {};
  let app: ElectronApplication | undefined;
  let win: Page | undefined;
  let dead: string | undefined;
  let versions: Record<string, string> = {};

  const note = (stepName: string, e: unknown) =>
    failures.push({
      step: stepName,
      reason: String((e as Error)?.message ?? e).slice(0, 600),
    });

  // Run one step; a failure is recorded, and later steps run only while the app is alive and answering.
  async function step<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T | undefined> {
    if (dead) {
      failures.push({ step: name, reason: `skipped: ${dead}` });
      return undefined;
    }
    try {
      return await fn();
    } catch (e) {
      note(name, e);
      try {
        await within(
          win!.evaluate(() => 1),
          15_000,
          'renderer not answering for 15 s'
        );
      } catch (e2) {
        dead = `after ${name} the renderer was gone or hung: ${String(
          (e2 as Error).message
        ).slice(0, 200)}`;
      }
      return undefined;
    }
  }

  const crashes: string[] = [];
  try {
    ({ app } = await launch(work));
    app.on('close', () =>
      crashes.push('main process exited (ElectronApplication close)')
    );
    await app.evaluate(({ app: a, ipcMain }) => {
      const g = globalThis as unknown as { gone: unknown[]; saves: number[] };
      g.gone = [];
      g.saves = [];
      a.on('render-process-gone', (_e, _wc, details) => g.gone.push(details));
      a.on('child-process-gone', (_e, details) => g.gone.push(details));
      // Prepended: the app's own handler writes the file synchronously, so a later listener would stamp after the write.
      ipcMain.prependListener('save-file', () => g.saves.push(Date.now()));
    });
    versions = await app.evaluate(
      () => ({ ...process.versions } as Record<string, string>)
    );
    win = await app.firstWindow();
    win.on('crash', () => crashes.push('renderer crashed (page crash event)'));
    win.on('pageerror', (e) =>
      crashes.push(`pageerror: ${String(e).slice(0, 200)}`)
    );
    await win.waitForLoadState('domcontentloaded');

    const goneReport = async (): Promise<string[]> => {
      try {
        const g = await app!.evaluate(
          () => (globalThis as unknown as { gone: unknown[] }).gone
        );
        return g.map((d) => JSON.stringify(d));
      } catch (e) {
        return [
          `could not read render-process-gone list: ${String(
            (e as Error).message
          ).slice(0, 150)}`,
        ];
      }
    };
    // A real function (Playwright serialises it): a function written as a string is evaluated as an expression, not
    // called, and is always truthy. `requireReplay` also asks for the Replay view.
    const lastParaEnds = ({
      tail: t,
      requireReplay,
    }: {
      tail: string;
      requireReplay: boolean;
    }) => {
      if (requireReplay && !document.querySelector('.ReplayContainer'))
        return false;
      const el = document.querySelector('.ProseMirror');
      if (!el) return false;
      let p = el.lastElementChild;
      while (p && !p.textContent) p = p.previousElementSibling;
      return !!p && !!p.textContent && p.textContent.endsWith(t);
    };

    // 1. OPEN ---------------------------------------------------------------------------------------------
    const opened = await step('open', async () => {
      const t0 = Date.now();
      await app!.evaluate(
        ({ ipcMain }, f) => ipcMain.emit('app-open', [f]),
        poem
      );
      // The app answers a file it cannot open with a modal message box (captured by the harness); say so at once
      // rather than waiting out the timeout.
      let watching = true;
      const refused = (async () => {
        while (watching) {
          const seen = await dialogsSeen(app!);
          if (seen.length) {
            m.openRefusedAfterMs = Date.now() - t0;
            throw new Error(`the app refused the file: ${seen.join(' | ')}`);
          }
          await sleep(250);
        }
        return undefined;
      })();
      refused.catch(() => undefined);
      const shown = win!.waitForFunction(
        lastParaEnds,
        { tail, requireReplay: false },
        { timeout: OPEN_TIMEOUT, polling: 100 }
      );
      shown.catch(() => undefined);
      try {
        await Promise.race([refused, shown]);
      } finally {
        watching = false;
      }
      m.openMs = Date.now() - t0;
      m.openDiag = {
        paragraphs: await win!.evaluate(
          () => document.querySelector('.ProseMirror')?.childElementCount ?? -1
        ),
        dialogs: await app!.evaluate(
          () =>
            (globalThis as unknown as { capturedDialogs?: string[] })
              .capturedDialogs ?? []
        ),
      };
      return true;
    });
    if (!opened)
      m.openMs = {
        failedAfterMs: m.openRefusedAfterMs ?? OPEN_TIMEOUT,
        timeoutMs: OPEN_TIMEOUT,
      };

    // The editor may save once on mount; wait for the file to go quiet so the typing/save steps start clean.
    if (opened) {
      await step('settle-after-open', async () => {
        const t0 = Date.now();
        let last = statSync(poem);
        let quietSince = Date.now();
        while (Date.now() - quietSince < 3_000) {
          if (Date.now() - t0 > OPEN_TIMEOUT)
            throw new Error('file still changing 120 s after open');
          // eslint-disable-next-line no-await-in-loop
          await sleep(100);
          const s = statSync(poem);
          if (s.size !== last.size || s.mtimeMs !== last.mtimeMs) {
            last = s;
            quietSince = Date.now();
          }
        }
        m.settleAfterOpenMs = quietSince - t0;
        m.savesDuringOpen = await app!.evaluate(
          () => (globalThis as unknown as { saves: number[] }).saves.length
        );
      });
    }

    // 2. KEYSTROKE-TO-SCREEN -------------------------------------------------------------------------------
    let lastKeyAt = 0;
    let keysTyped = 0;
    let savesBefore = 0;
    const samples: {
      stat: { t: number; size: number; mtimeMs: number }[];
      statErrors: string[];
      stop: () => void;
    } = {
      stat: [],
      statErrors: [],
      stop: () => undefined,
    };
    if (opened) {
      await step('keystrokes', async () => {
        await win!.evaluate(() => {
          const w = window as unknown as { __ks: Record<string, unknown> };
          const ed = () =>
            document.querySelector('.ProseMirror') as HTMLElement;
          const lastP = () => ed().lastElementChild as HTMLElement;
          // The caret goes to the end of the last paragraph.
          const p = lastP();
          const r = document.createRange();
          r.selectNodeContents(p);
          r.collapse(false);
          const sel = window.getSelection()!;
          sel.removeAllRanges();
          sel.addRange(r);
          ed().focus();
          p.scrollIntoView();
          const ks = {
            pending: [] as number[],
            dom: [] as number[],
            screen: [] as number[],
            lag: [] as number[],
            done: 0,
            len: lastP().textContent!.length,
          };
          w.__ks = ks;
          document.addEventListener(
            'keydown',
            (e) => {
              if (e.key.length !== 1) return;
              ks.pending.push(e.timeStamp);
              ks.lag.push(performance.now() - e.timeStamp);
            },
            true
          );
          new MutationObserver(() => {
            const now = performance.now();
            const len = lastP().textContent!.length;
            if (len <= ks.len) return;
            const gained = len - ks.len;
            ks.len = len;
            const ts = ks.pending.splice(0, gained);
            ts.forEach((t) => ks.dom.push(now - t));
            ks.done += ts.length;
            requestAnimationFrame(() =>
              setTimeout(() => {
                const n = performance.now();
                ts.forEach((t) => ks.screen.push(n - t));
              }, 0)
            );
          }).observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
          });
        });
        // Poll the file from the test process from here on: the save step reads these observations.
        const base = statSync(poem);
        samples.stat.push({
          t: Date.now(),
          size: base.size,
          mtimeMs: base.mtimeMs,
        });
        const timer = setInterval(() => {
          try {
            const s = statSync(poem);
            const prev = samples.stat[samples.stat.length - 1];
            if (s.size !== prev.size || s.mtimeMs !== prev.mtimeMs)
              samples.stat.push({
                t: Date.now(),
                size: s.size,
                mtimeMs: s.mtimeMs,
              });
          } catch (e) {
            // A replace-by-rename can leave no file for an instant; the next tick sees it. Kept, not dropped.
            samples.statErrors.push(String((e as Error).message).slice(0, 150));
          }
        }, 10);
        samples.stop = () => clearInterval(timer);
        savesBefore = await app!.evaluate(
          () => (globalThis as unknown as { saves: number[] }).saves.length
        );
        for (let i = 0; i < KEYS; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await win!.keyboard.press(TYPED[i % TYPED.length]);
          // eslint-disable-next-line no-await-in-loop
          await win!.waitForFunction(
            (n) =>
              (window as unknown as { __ks: { done: number } }).__ks.done >= n,
            i + 1,
            { timeout: KEY_TIMEOUT, polling: 5 }
          );
          lastKeyAt = Date.now();
          keysTyped = i + 1;
          // eslint-disable-next-line no-await-in-loop
          await win!.waitForTimeout(80);
        }
      });
      const ks = await win!
        .evaluate(() => {
          const k = (window as unknown as { __ks?: Record<string, number[]> })
            .__ks;
          return k ? { dom: k.dom, screen: k.screen, lag: k.lag } : undefined;
        })
        .catch((e) => {
          note('keystrokes-read', e);
          return undefined;
        });
      if (ks) {
        m.keystrokeDomMs = dist(ks.dom);
        m.keystrokeScreenMs = dist(ks.screen);
        m.keydownListenerLagMs = dist(ks.lag);
      }
    }

    // 3. SAVE ---------------------------------------------------------------------------------------------
    if (opened && lastKeyAt) {
      await step('save', async () => {
        const deadline = Date.now() + SAVE_TIMEOUT;
        let sentAt = 0;
        while (!sentAt) {
          if (Date.now() > deadline)
            throw new Error(
              `no save-file message ${SAVE_TIMEOUT} ms after the last key`
            );
          // eslint-disable-next-line no-await-in-loop
          const saves = await app!.evaluate(
            () => (globalThis as unknown as { saves: number[] }).saves
          );
          // The first save sent after the last key was shown: autosaves that fired while a slow run was still typing
          // do not count.
          const shownAt = lastKeyAt;
          const after = saves.slice(savesBefore).find((t) => t >= shownAt);
          if (after) sentAt = after;
          // eslint-disable-next-line no-await-in-loop
          else await sleep(50);
        }
        // The file must change after the send and then stay unchanged for SAVE_QUIET_MS.
        const changedAfterSend = () =>
          samples.stat.filter((s, i) => i > 0 && s.t >= sentAt - 20);
        for (;;) {
          if (Date.now() > deadline) {
            m.saveDebug = {
              sentAt,
              now: Date.now(),
              samples: samples.stat.slice(-10),
            };
            throw new Error(
              `file not written and quiet within ${SAVE_TIMEOUT} ms of the send`
            );
          }
          const ch = changedAfterSend();
          if (
            ch.length > 0 &&
            Date.now() - ch[ch.length - 1].t >= SAVE_QUIET_MS
          )
            break;
          // eslint-disable-next-line no-await-in-loop
          await sleep(100);
        }
        const ch = changedAfterSend();
        m.saveMs = ch[ch.length - 1].t - sentAt;
        m.saveFirstChangeMs = ch[0].t - sentAt;
        m.saveFileChanges = ch.length;
        m.savePrepMs = sentAt - (lastKeyAt + 1000);
        m.saveFromTimerMs = ch[ch.length - 1].t - (lastKeyAt + 1000);
        m.saveFinalBytes = statSync(poem).size;
        m.saveStatErrors = {
          n: samples.statErrors.length,
          first: samples.statErrors.slice(0, 3),
        };
        const cfg = join(work, 'userdata', 'config.json');
        m.storeConfigBytes = statSync(cfg).size;
      });
      samples.stop();
    }

    // 4. REPLAY -------------------------------------------------------------------------------------------
    if (opened) {
      const replay: Record<string, unknown> = { setFps: SET_FPS };
      m.replay = replay;
      // What the last frame ends with: the original ending, or the text typed above if that step ran.
      // Only the keys that were shown: a typing step that failed part-way leaves fewer than KEYS.
      const typedAll = Array.from(
        { length: keysTyped },
        (_, i) => TYPED[i % TYPED.length]
      ).join('');
      const replayTail = `${tail}${typedAll}`.slice(-30);
      const inReplay = await step('replay-open', async () => {
        const t0 = Date.now();
        await win!
          .getByRole('link', { name: 'Replay' })
          .click({ timeout: REPLAY_TIMEOUT });
        await win!.waitForFunction(
          lastParaEnds,
          { tail: replayTail, requireReplay: true },
          { timeout: REPLAY_TIMEOUT, polling: 100 }
        );
        replay.openMs = Date.now() - t0;
        replay.maxStep = Number(
          await win!
            .locator('.MuiSlider-thumb input')
            .getAttribute('aria-valuemax')
        );
        return true;
      });

      if (inReplay) {
        await step('replay-play', async () => {
          await win!.evaluate(() => {
            const w = window as unknown as {
              __pl: { t: number; v: number }[];
              __plTimer: number;
            };
            w.__pl = [];
            const input = document.querySelector(
              '.MuiSlider-thumb input'
            ) as HTMLInputElement;
            w.__plTimer = window.setInterval(
              () =>
                w.__pl.push({ t: performance.now(), v: Number(input.value) }),
              25
            );
          });
          await win!
            .locator('[data-testid="PlayArrowIcon"]')
            .first()
            .click({ timeout: REPLAY_TIMEOUT });
          // Wait for the first advance (play from the last frame rewinds to 0 first), then sample.
          await win!.waitForFunction(
            () => {
              const w = window as unknown as { __pl: { v: number }[] };
              return w.__pl.some(
                (s, i) => i > 0 && s.v > 0 && w.__pl[i - 1].v === 0
              );
            },
            undefined,
            { timeout: REPLAY_TIMEOUT, polling: 50 }
          );
          await win!.waitForTimeout(PLAY_SECONDS * 1000);
          // A blocked page takes no samples: give it up to 120 s more to show two further distinct frames.
          await win!
            .waitForFunction(
              () => {
                const w = window as unknown as { __pl: { v: number }[] };
                return new Set(w.__pl.map((x) => x.v)).size >= 4;
              },
              undefined,
              { timeout: 120_000, polling: 250 }
            )
            .catch(() => {
              replay.playTooFewFrames = true;
            });
          const s = await win!.evaluate(() => {
            const w = window as unknown as {
              __pl: { t: number; v: number }[];
              __plTimer: number;
            };
            clearInterval(w.__plTimer);
            return w.__pl;
          });
          const from = s.findIndex(
            (x, i) => i > 0 && x.v > 0 && s[i - 1].v === 0
          );
          const seg = s.slice(from);
          const a = seg[0];
          const b = seg[seg.length - 1];
          replay.playSampleSeconds = (b.t - a.t) / 1000;
          replay.playFrames = b.v - a.v;
          replay.achievedFps =
            b.t > a.t ? ((b.v - a.v) / (b.t - a.t)) * 1000 : 0;
          // The longest time the slider value stayed unchanged between two samples while playing.
          let stall = 0;
          let since = seg[0].t;
          for (let i = 1; i < seg.length; i += 1) {
            if (seg[i].v !== seg[i - 1].v) {
              stall = Math.max(stall, seg[i].t - since);
              since = seg[i].t;
            }
          }
          replay.longestStallMs = stall;
          await win!
            .locator('[data-testid="PauseIcon"]')
            .first()
            .click({ timeout: 120_000 });
        });

        await step('replay-slider', async () => {
          const box = await win!
            .locator('.MuiSlider-root')
            .first()
            .boundingBox({ timeout: 30_000 })
            .catch(() => null);
          const rail =
            box ??
            (await win!.locator('.MuiSlider-root').first().boundingBox());
          if (!rail) throw new Error('slider has no bounding box');
          const dom: number[] = [];
          const screen: number[] = [];
          const positions: { f: number; value: number }[] = [];
          for (const f of SLIDER_POSITIONS) {
            // eslint-disable-next-line no-await-in-loop
            await win!.evaluate(() => {
              const w = window as unknown as {
                __sl: Record<string, number | undefined>;
              };
              w.__sl = {};
              const root = document.querySelector('.ReplayContainer')!;
              document.addEventListener(
                'pointerdown',
                (e) => {
                  w.__sl.t0 = e.timeStamp;
                  const mo = new MutationObserver(() => {
                    mo.disconnect();
                    w.__sl.dom = performance.now() - e.timeStamp;
                    requestAnimationFrame(() =>
                      setTimeout(() => {
                        w.__sl.screen = performance.now() - e.timeStamp;
                      }, 0)
                    );
                  });
                  mo.observe(root, {
                    subtree: true,
                    childList: true,
                    characterData: true,
                  });
                },
                { capture: true, once: true }
              );
            });
            // eslint-disable-next-line no-await-in-loop
            await win!.mouse.click(
              rail.x + rail.width * f,
              rail.y + rail.height / 2
            );
            // eslint-disable-next-line no-await-in-loop
            await win!.waitForFunction(
              () =>
                (window as unknown as { __sl: { screen?: number } }).__sl
                  .screen !== undefined,
              undefined,
              { timeout: SLIDER_TIMEOUT, polling: 5 }
            );
            // eslint-disable-next-line no-await-in-loop
            const r = await win!.evaluate(() => {
              const w = window as unknown as {
                __sl: { dom: number; screen: number };
              };
              return {
                dom: w.__sl.dom,
                screen: w.__sl.screen,
                value: Number(
                  (
                    document.querySelector(
                      '.MuiSlider-thumb input'
                    ) as HTMLInputElement
                  ).value
                ),
              };
            });
            dom.push(r.dom);
            screen.push(r.screen);
            positions.push({ f, value: r.value });
            // eslint-disable-next-line no-await-in-loop
            await win!.waitForTimeout(500);
          }
          replay.sliderDomMs = dist(dom);
          replay.sliderScreenMs = dist(screen);
          replay.sliderPositions = positions;
          replay.sliderDomEachMs = dom;
        });
      }
    }

    crashes.push(...(await goneReport()).filter((g) => g !== '[]'));
  } catch (e) {
    note('harness', e);
  } finally {
    if (crashes.length)
      failures.push({ step: 'crash', reason: crashes.join(' | ') });
    const out = {
      spec: 'editor',
      // Size only, never the path: a hand run on a real poem would put its name in the result.
      fileBytes,
      finalChars: chars,
      versions: {
        electron: versions.electron,
        chromium: versions.chrome,
        node: versions.node,
      },
      steps: m,
      failures,
      finishedAt: new Date().toISOString(),
    };
    writeFileSync(RESULT, JSON.stringify(out, null, 2));
    try {
      await app?.close();
    } catch (e) {
      // The app may already be gone (recorded above as a crash); the message goes to the run's log either way.
      // eslint-disable-next-line no-console -- the run's log is where this belongs
      console.error(`app.close() failed: ${String((e as Error).message)}`);
    }
    rmSync(work, { recursive: true, force: true });
  }
  if (failures.length)
    throw new Error(
      `size-limit run failed:\n${failures
        .map((f) => `${f.step}: ${f.reason}`)
        .join('\n')}`
    );
});
