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
