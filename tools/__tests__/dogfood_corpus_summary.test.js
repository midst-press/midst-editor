/**
 * @jest-environment node
 */
// tools/dogfood_corpus.py summary (#192): a control fires only when its named oracles are red AND the instruments
// it depends on reached what they measure. Synthetic manifest and results; no poem data.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'dogfood_corpus.py');

// One synthetic poem with two history entries, so manifest() writes the C-history control from the script's own specs.
const POEM = {
  text: '<p>zq <em>xv</em></p><p>qz</p>',
  history: [
    { front: 0, inserted: 'z', end: 0, t: '2020-01-01T00:00:00.000Z', pos: 0 },
    { front: 1, inserted: 'q', end: 0, t: '2020-01-01T00:00:01.000Z', pos: 1 },
  ],
};

function summarise(row) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dogfood-summary-'));
  try {
    const converted = path.join(work, 'converted');
    fs.mkdirSync(converted);
    fs.writeFileSync(
      path.join(converted, 'zq.converted.midst'),
      JSON.stringify(POEM)
    );
    const made = spawnSync('python3', [SCRIPT, 'manifest', converted, work], {
      encoding: 'utf8',
    });
    if (made.status !== 0)
      throw new Error(
        `manifest failed (${made.status}): ${made.stdout}${made.stderr}`
      );
    const { cases } = JSON.parse(
      fs.readFileSync(path.join(work, 'manifest.json'), 'utf8')
    );
    // Every case passes, except C-history, whose row is the one under test.
    const rowFor = (c) => {
      if (c.id === 'C-history')
        return { id: c.id, mustFail: true, frames: 2, ...row };
      if (!c.mustFail)
        return { id: c.id, mustFail: false, frames: 2, pass: true };
      const red = Object.fromEntries(c.red.map((k) => [k, false]));
      return {
        id: c.id,
        mustFail: true,
        frames: 2,
        opens: true,
        text: true,
        historyReachable: true,
        ...red,
      };
    };
    const rows = cases.map(rowFor);
    expect(cases.some((c) => c.id === 'C-history')).toBe(true);
    fs.writeFileSync(
      path.join(work, 'results.jsonl'),
      `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`
    );
    return spawnSync('python3', [SCRIPT, 'summary', work], {
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

describe('C-history', () => {
  const red = { opens: true, history: false, storeHistory: false };

  it('fires when the history walk reached the history and both history oracles are red', () => {
    const r = summarise({ ...red, historyReachable: true });
    expect(r.stdout).toContain('control fired');
    expect(r.status).toBe(0);
  });

  it('does not fire when the history walk could not reach the history, whatever the oracles say', () => {
    const r = summarise({ ...red, historyReachable: false });
    expect(r.stdout).toMatch(/C-history .*CONTROL DID NOT FIRE/);
    expect(r.status).toBe(1);
  });

  it('prints whether the history walk reached the history', () => {
    expect(summarise({ ...red, historyReachable: false }).stdout).toMatch(
      /reach/
    );
  });
});
