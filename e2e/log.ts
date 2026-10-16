import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// The app's log is strict JSONL (src/main/logging.ts): one JSON object per line. This reader holds the
// app to that. A line that does not parse is a defect in the log, not something to skip, so it throws,
// naming the line.

export type LogRecord = {
  ts: string;
  level: string;
  source: 'main' | 'renderer';
  msg: string;
  meta?: unknown;
};

export function parseLog(text: string, where = 'main.log'): LogRecord[] {
  const records: LogRecord[] = [];
  text.split('\n').forEach((line, index) => {
    if (line === '' && index === text.split('\n').length - 1) return; // the final newline
    try {
      records.push(JSON.parse(line) as LogRecord);
    } catch (e) {
      throw new Error(
        `${where} line ${index + 1} is not JSON (${
          (e as Error).name
        }): ${line.slice(0, 80)}`
      );
    }
  });
  return records;
}

// An absent file is no records: before the app has logged anything there is nothing to read.
export function readLog(dir: string): LogRecord[] {
  const file = join(dir, 'main.log');
  return existsSync(file) ? parseLog(readFileSync(file, 'utf8'), file) : [];
}
