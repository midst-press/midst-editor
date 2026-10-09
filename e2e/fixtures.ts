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
