import { describeError } from '../shared/errorSummary';

// Errors nothing caught, in the renderer, reach the log through the same bridge as every other
// renderer entry. Only the error's name and frames are sent, never its message (see errorSummary.ts).
// Without this they appear only in a devtools console that a poet does not have open.

/* eslint-disable no-unused-vars -- the names in these function types say what each argument is */
type ErrorLogger = { error: (message: string, meta?: unknown) => void };
/* eslint-enable no-unused-vars */
type ErrorTarget = Pick<Window, 'addEventListener'>;

export default function registerUncaughtErrorLogging(
  target: ErrorTarget,
  logger: ErrorLogger
): void {
  target.addEventListener('error', (event: ErrorEvent) => {
    logger.error('uncaught error', describeError(event.error));
  });
  target.addEventListener(
    'unhandledrejection',
    (event: PromiseRejectionEvent) => {
      logger.error('uncaught error', describeError(event.reason));
    }
  );
}
