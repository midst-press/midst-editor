// Synthetic .midst documents for the end-to-end tests.
//
// WHY GENERATED, NOT COMMITTED. Annelyse supplied real demonstration files for the bug this suite
// exists to catch, and they are genuinely synthetic -- their text is "This is Poem A." and
// "This is ONLY poem b.". But the repository refuses .midst files by extension, deliberately, because
// that rule is what keeps poets' work out of git. Carving an exception into it for files that merely
// happen to be safe is the wrong trade, so these are built at test time instead. Her files supplied
// the schema and the expected numbers; nothing of hers is stored here.
//
// Format C, which is what the app writes (src/main/util.ts):
//   line 1   midstVersion: 1
//   line 2   {"text": "<html>", "history": [ {inserted, front, end, t, pos}, ... ]}
// stripVersionInfo() takes line 1 by index, so the JSON must stay on a single line.

// The application's own change recorder and type, so a generated fixture is valid by
// construction rather than by this file computing front/end offsets correctly.
import { compareStrings, ChangeObj } from '../src/renderer/tracking/utils';

export const MIDST_VERSION_HEADER = 'midstVersion: 1';

export interface Doc {
  file: string;
  text: string;
  historyLength: number;
  sentinel: string;
}

// Build a document by "typing" a sentinel string one character at a time, which is the shape the real
// editor produces: one history entry per keystroke.
export function makeMidst(sentinel: string, extraChars: number): Doc {
  const body = `${sentinel}${'x'.repeat(extraChars)}`;
  const history: Array<Record<string, string | number>> = [];
  const epoch = Date.parse('2026-08-22T20:00:00.000Z');
  for (let i = 0; i < body.length; i += 1) {
    history.push({
      inserted: i === 0 ? `<p>${body[i]}</p>` : body[i],
      front: i + 4,
      end: i + 4,
      t: new Date(epoch + i * 100).toISOString(),
      pos: i + 2,
    });
  }
  const text = `<p>${body}</p>`;
  // No trailing newline: the app's own files have none, and stripVersionInfo indexes line 1.
  const file = `${MIDST_VERSION_HEADER}\n${JSON.stringify({ text, history })}`;
  return { file, text, historyLength: history.length, sentinel };
}

// Read a .midst back without going through the app, so the oracle is the bytes on disk.
export function parseMidst(raw: string): { text: string; history: unknown[] } {
  return JSON.parse(raw.split('\n')[1]);
}

// ---------------------------------------------------------------------------------------------
// A PLAYABLE document.
//
// makeMidst above is fine for the open/save tests, which only care that a file loads and that its
// history length is distinguishable. It is NOT playable: its front/end values are invented, and a
// fixture whose frames do not reconstruct simply renders frame zero forever -- measured, and it is
// why an earlier hand-built fixture appeared to show playback as broken when the app was fine.
//
// So the history here is derived by the APPLICATION'S OWN recorder, `compareStrings`, from a
// sequence of HTML states. Validity is then structural rather than something this file has to get
// right. `step()` in tracking/utils.ts reconstructs as
// `prev.slice(0, front) + inserted + prev.slice(prev.length - end)`, and compareStrings is the
// function that produces those numbers when a poet types.
//
// The STRUCTURE is taken from Annelyse's Autoscroll Test Poem -- one `<p>`, one keystroke per
// frame, `pos` advancing with the caret. None of her content is used or stored.

export interface PlayableDoc {
  file: string;
  finalHtml: string;
  finalText: string;
  history: ChangeObj[];
}

export function makePlayableMidst(sentence: string): PlayableDoc {
  // One HTML state per keystroke, exactly as typing produces.
  const states: string[] = [];
  for (let i = 1; i <= sentence.length; i += 1) {
    states.push(`<p>${sentence.slice(0, i)}</p>`);
  }

  const history: ChangeObj[] = [];
  let prev = '';
  states.forEach((next, i) => {
    // `pos` is the caret position in the document, which is what autoscroll follows. It does not
    // affect reconstruction; it is here so the frames are shaped like real ones.
    history.push(compareStrings(prev, next, i + 2));
    prev = next;
  });

  const finalHtml = states[states.length - 1];
  return {
    file: `${MIDST_VERSION_HEADER}\n${JSON.stringify({
      text: finalHtml,
      history,
    })}`,
    finalHtml,
    finalText: sentence,
    history,
  };
}

// ---------------------------------------------------------------------------------------------
// A TALL poem whose writing JUMPS between distant lines, for Replay's scrolling (midst-press/midst-web#32,
// Annelyse: "when the author jumps to a place that was off screen, the content should scroll gently to
// that new point"). Frame 0 is the whole poem; then, at each target line in turn, ten letters are typed
// at the end of the line, one frame per letter, with `pos` at the caret as the editor records it
// (`editor.state.selection.$anchor.pos`). Invented letters only.
export interface JumpingDoc extends PlayableDoc {
  lines: number;
  targets: number[];
  typed: number;
}

// at 'end' types after the last character of the line; 'middle' types after its first character (editing a
// word already there), which puts the caret inside a text node.
export function makeJumpingMidst(
  at: 'end' | 'middle' = 'end',
  lines = 150,
  targets = [140, 3, 110, 20, 148, 1],
  typed = 10
): JumpingDoc {
  const text = Array.from(
    { length: lines },
    (_, i) => `abc ${'d'.repeat(1 + (i % 7))} efg`
  );
  const html = (t: string[]) => t.map((s) => `<p>${s}</p>`).join('');
  // ProseMirror position just after character c of line k: each earlier paragraph is size + 2.
  const caret = (t: string[], k: number, c: number) =>
    t.slice(0, k).reduce((n, s) => n + s.length + 2, 0) + 1 + c;
  const history: ChangeObj[] = [];
  let prev = '';
  const cur = text.slice();
  history.push(compareStrings(prev, html(cur), caret(cur, 0, 0)));
  prev = html(cur);
  targets.forEach((k) => {
    for (let j = 0; j < typed; j += 1) {
      const c = at === 'end' ? cur[k].length : 1 + j;
      cur[k] = `${cur[k].slice(0, c)}z${cur[k].slice(c)}`;
      const next = html(cur);
      history.push(compareStrings(prev, next, caret(cur, k, c + 1)));
      prev = next;
    }
  });
  const finalHtml = prev;
  return {
    file: `${MIDST_VERSION_HEADER}\n${JSON.stringify({
      text: finalHtml,
      history,
    })}`,
    finalHtml,
    finalText: cur.join(''),
    history,
    lines,
    targets,
    typed,
  };
}
