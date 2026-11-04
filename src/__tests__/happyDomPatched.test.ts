/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// Every happy-dom the lockfile installs is 21.0.4 or later (#386, GitHub alerts #145, #162). It ships in the main
// process, where rtf.ts (@tiptap/html/server) and the vendored convert parse poem HTML from files the poet opens. A copy
// below 21.0.4 can also arrive nested, through a dependency's own range, so every entry is checked.
const PATCHED = [21, 0, 4];

const atLeast = (version: string, floor: number[]) => {
  const parts = version.split(/[.-]/).slice(0, 3).map(Number);
  const differs = [0, 1, 2].find((i) => parts[i] !== floor[i]);
  return differs === undefined || parts[differs] > floor[differs];
};

describe('happy-dom', () => {
  it('is 21.0.4 or later wherever the lockfile installs it', () => {
    const lock = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package-lock.json'), 'utf8')
    ) as { packages: Record<string, { version?: string }> };
    const found = Object.entries(lock.packages)
      .filter(([where]) => where.endsWith('node_modules/happy-dom'))
      .map(([where, entry]) => [where, entry.version ?? '']);
    // Positive control: the lockfile does install happy-dom, so an empty list cannot pass.
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter(([, version]) => !atLeast(version, PATCHED))).toEqual(
      []
    );
  });

  it('compares versions numerically', () => {
    expect(atLeast('21.0.4', PATCHED)).toBe(true);
    expect(atLeast('21.0.10', PATCHED)).toBe(true);
    expect(atLeast('22.0.0', PATCHED)).toBe(true);
    expect(atLeast('21.0.3', PATCHED)).toBe(false);
    expect(atLeast('20.14.6', PATCHED)).toBe(false);
  });
});
