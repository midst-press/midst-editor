/* eslint-disable max-classes-per-file -- each test defines its own small error class */
import { describeError } from '../shared/errorSummary';

// Synthetic values only.
describe('describeError', () => {
  it('keeps the name and the stack frames of an Error', () => {
    const summary = describeError(new TypeError('zq'));
    expect(summary.name).toBe('TypeError');
    expect(summary.frames.length).toBeGreaterThan(0);
    summary.frames.forEach((f) => expect(f).toMatch(/^\s*at /));
  });

  it('drops the message, including the extra lines of a multi-line one', () => {
    const e = new Error(
      'first secret\nsecond secret\n    at looks-like-a-frame-but-is-text'
    );
    const text = JSON.stringify(describeError(e));
    expect(text).not.toContain('first secret');
    expect(text).not.toContain('second secret');
    expect(text).not.toContain('looks-like-a-frame');
  });

  // A poem line can start with "at "; these failed when any "at " line after the first was kept.
  it('drops message lines that start with "at ", and keeps the real frames', () => {
    const e = new Error(
      'bad\nat dusk the water folds\n  at last the reeds lie down'
    );
    const summary = describeError(e);
    const text = JSON.stringify(summary);
    expect(text).not.toContain('dusk');
    expect(text).not.toContain('reeds');
    expect(summary.frames).toEqual((e.stack as string).split('\n').slice(3));
  });

  it('drops the input that JSON.parse quotes, newline and all', () => {
    let thrown: unknown;
    try {
      JSON.parse('x\nat dusk the heron lifts\n');
    } catch (e) {
      thrown = e;
    }
    const summary = describeError(thrown);
    expect(summary.name).toBe('SyntaxError');
    expect(JSON.stringify(summary)).not.toContain('heron');
    expect(summary.frames.length).toBeGreaterThan(0);
    summary.frames.forEach((f) => expect(f).toMatch(/^\s+at /));
  });

  it('keeps every frame of an ordinary error', () => {
    const e = new RangeError('zq');
    expect(describeError(e).frames).toEqual(
      (e.stack as string).split('\n').slice(1)
    );
  });

  it('cuts the header when the name was set after the stack was taken', () => {
    class LateNameError extends Error {
      constructor() {
        super('one\nat dusk two');
        this.name = 'LateNameError';
      }
    }
    const e = new LateNameError();
    const summary = describeError(e);
    expect(summary.name).toBe('LateNameError');
    expect(JSON.stringify(summary)).not.toContain('dusk');
    expect(summary.frames).toEqual((e.stack as string).split('\n').slice(2));
  });

  it('keeps only located frames when the message changed after the stack was taken', () => {
    const e = new Error('first\nat dusk the heron lifts');
    // V8 formats the stack when it is first read, so read it before changing the message.
    const stack = e.stack as string;
    e.message = 'something else';
    const summary = describeError(e);
    expect(JSON.stringify(summary)).not.toContain('heron');
    expect(summary.frames).toEqual(stack.split('\n').slice(2));
  });

  it.each([
    ['a location in brackets', '    at f (/a/b.js:1:2)', true],
    ['a bare location', '    at /a/b.js:10:20', true],
    ['an anonymous frame', '    at JSON.parse (<anonymous>)', true],
    ['a native frame', '    at Array.map (native)', true],
    ['an async frame', '    at async Promise.all (index 0)', true],
    ['a poem line', '  at last the reeds lie down', false],
    ['a poem line ending in brackets', '  at dusk (the heron)', false],
    ['a location not indented', 'at f (/a/b.js:1:2)', false],
  ])(
    'a line is kept as a frame only if it ends in a location: %s',
    (_l, line, kept) => {
      const value = {
        name: 'Odd',
        message: 'not in the stack',
        stack: `Odd\n${line}`,
      };
      expect(describeError(value).frames).toEqual(kept ? [line] : []);
    }
  );

  it('drops a message line that ends like a location, by cutting the header', () => {
    const e = new Error('x\n    at dusk (heron:1:2)');
    const summary = describeError(e);
    expect(JSON.stringify(summary)).not.toContain('heron');
    expect(summary.frames).toEqual((e.stack as string).split('\n').slice(2));
  });

  it('drops the rest of a message that was shortened after the stack was taken', () => {
    const e = new Error('first\nat dusk the heron lifts');
    const stack = e.stack as string;
    [e.message] = e.message.split('\n');
    const summary = describeError(e);
    expect(JSON.stringify(summary)).not.toContain('heron');
    expect(summary.frames).toEqual(stack.split('\n').slice(2));
  });

  it('keeps every frame when the message was changed to text found in a frame', () => {
    const e = new Error('zq');
    const stack = e.stack as string;
    e.message = 'errorSummary.test';
    expect(describeError(e).frames).toEqual(stack.split('\n').slice(1));
  });

  it('an error-like value with no message keeps only located frames', () => {
    const value = {
      name: 'Odd',
      stack: 'Odd\n  at dusk the heron lifts\n    at f (/a/b.js:1:2)',
    };
    expect(describeError(value).frames).toEqual(['    at f (/a/b.js:1:2)']);
  });

  it('an error with an empty message keeps the frames after its one header line', () => {
    const e = new Error('');
    expect(describeError(e).frames).toEqual(
      (e.stack as string).split('\n').slice(1)
    );
  });

  it('uses a custom error name', () => {
    class OddError extends Error {
      constructor() {
        super('zq');
        this.name = 'OddError';
      }
    }
    expect(describeError(new OddError()).name).toBe('OddError');
  });

  it('has no frames when there is no stack', () => {
    const e = new Error('zq');
    e.stack = undefined;
    expect(describeError(e)).toEqual({ name: 'Error', frames: [] });
  });

  it.each([
    ['a string', 'zq'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 3],
    ['an object with a name and message', { name: 'Fake', message: 'zq' }],
  ])('reports %s as NonError with no content', (_l, value) => {
    expect(describeError(value)).toEqual({ name: 'NonError', frames: [] });
  });

  it('recognises an error from another realm, and still drops its message', () => {
    // eslint-disable-next-line global-require
    const vm = require('vm');
    const foreign = vm.runInNewContext("new TypeError('zq-foreign-text')");
    expect(foreign instanceof Error).toBe(false);
    const summary = describeError(foreign);
    expect(summary.name).toBe('TypeError');
    expect(JSON.stringify(summary)).not.toContain('zq-foreign-text');
  });

  it('an object with a name but no stack is not an error', () => {
    expect(describeError({ name: 'zq' })).toEqual({
      name: 'NonError',
      frames: [],
    });
  });
});
