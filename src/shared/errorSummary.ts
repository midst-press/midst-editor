// What the log may say about a thrown value: its name and where it was thrown, never its message.
// An Error's message can quote the text of a file being read (a JSON parse error does), and a
// poem's text must never reach the log. Shared by the main process and the renderer.

export type ErrorSummary = { name: string; frames: string[] };

// A V8 stack frame. A multi-line message puts further lines of its own before the first frame, so
// "everything after the first line" is not enough to keep message text out; only frames are kept.
const FRAME = /^\s*at\s/;

export function describeError(value: unknown): ErrorSummary {
  if (!(value instanceof Error)) return { name: 'NonError', frames: [] };
  const stack = typeof value.stack === 'string' ? value.stack : '';
  return {
    name: String(value.name),
    frames: stack
      .split('\n')
      .slice(1)
      .filter((line) => FRAME.test(line)),
  };
}
