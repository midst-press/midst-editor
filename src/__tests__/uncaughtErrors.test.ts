import registerUncaughtErrorLogging from '../renderer/uncaughtErrors';

// Synthetic values only.
describe('registerUncaughtErrorLogging', () => {
  const SECRET = 'the quick brown fox';
  const setup = () => {
    const target = new EventTarget();
    const logger = { error: jest.fn() };
    registerUncaughtErrorLogging(
      target as unknown as Pick<Window, 'addEventListener'>,
      logger
    );
    return { target, logger };
  };
  const fire = (target: EventTarget, type: string, props: object) => {
    const event = new Event(type);
    Object.assign(event, props);
    target.dispatchEvent(event);
  };

  it('logs an error event as "uncaught error" with name and frames, not the message', () => {
    const { target, logger } = setup();
    fire(target, 'error', { error: new TypeError(`bad ${SECRET}`) });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('uncaught error', {
      name: 'TypeError',
      frames: expect.any(Array),
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(SECRET);
  });

  it('logs an unhandled rejection the same way', () => {
    const { target, logger } = setup();
    fire(target, 'unhandledrejection', {
      reason: new RangeError(`bad ${SECRET}`),
    });
    expect(logger.error).toHaveBeenCalledWith('uncaught error', {
      name: 'RangeError',
      frames: expect.any(Array),
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(SECRET);
  });

  it('logs an error event with no Error (a script error from elsewhere) as NonError', () => {
    const { target, logger } = setup();
    fire(target, 'error', { error: null, message: `Script error ${SECRET}` });
    expect(logger.error).toHaveBeenCalledWith('uncaught error', {
      name: 'NonError',
      frames: [],
    });
  });

  it('logs a rejection with a non-Error reason without its content', () => {
    const { target, logger } = setup();
    fire(target, 'unhandledrejection', { reason: `text ${SECRET}` });
    expect(logger.error).toHaveBeenCalledWith('uncaught error', {
      name: 'NonError',
      frames: [],
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(SECRET);
  });

  it('ignores other events', () => {
    const { target, logger } = setup();
    fire(target, 'click', {});
    expect(logger.error).not.toHaveBeenCalled();
  });
});
