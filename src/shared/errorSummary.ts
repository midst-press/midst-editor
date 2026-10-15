// What the log may say about a thrown value: its name and where it was thrown, never its message.
// An Error's message can quote the text of a file being read (a JSON parse error does), and a
// poem's text must never reach the log. Shared by the main process and the renderer.

export type ErrorSummary = { name: string; frames: string[] };

// A V8 stack frame ends in where it ran: "(file:line:col)", "file:line:col", "(<anonymous>)",
// "(native)" or "(index N)". A line of the message can start with "at " too (a poem line can), so
// only lines ending in a location are kept.
const FRAME =
  /^\s+at\s.*(?:\(.*:\d+:\d+\)|:\d+:\d+|\(<anonymous>\)|\(native\)|\(index \d+\))$/;

// An error from another realm (a vm context, a different window, some Node internals under test) is
// not `instanceof Error` here, so an object with a string name and stack counts as one too.
const isErrorLike = (value: unknown): value is Error =>
  value instanceof Error ||
  (typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { stack?: unknown }).stack === 'string');

// V8 writes the stack header as "<name>: <message>". Cutting through the end of the message also
// removes a message line that happens to end like a location. The message is used only to find
// where the header ends, and is never returned. When it is not in the first line (it was changed
// after the stack was taken), nothing is cut and the frame test alone decides.
function framesOf(stack: string, message: unknown): string[] {
  let body = stack;
  if (typeof message === 'string') {
    const at = stack.indexOf(message);
    if (at !== -1 && !stack.slice(0, at).includes('\n')) {
      body = stack.slice(at + message.length);
    }
  }
  return body.split('\n').filter((line) => FRAME.test(line));
}

export function describeError(value: unknown): ErrorSummary {
  if (!isErrorLike(value)) return { name: 'NonError', frames: [] };
  const stack = typeof value.stack === 'string' ? value.stack : '';
  return {
    name: String(value.name),
    frames: framesOf(stack, (value as { message?: unknown }).message),
  };
}
