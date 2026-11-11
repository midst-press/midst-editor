/**
 * @jest-environment node
 */
// tools/verify_candidate.sh refuses an audition build (GitHub #119), on a fake download laid out the way
// `gh run download` lays out a package run.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'verify_candidate.sh');
const COMMIT = 'c'.repeat(40);
const VERSION = '1.2.3';

// One artifact folder per platform holding an installer, plus build-info-<platform>/<platform>.json.
function download(tmp, { audition = {}, macName } = {}) {
  const installers = {
    macos: `Midst-${VERSION}-arm64.pkg`,
    windows: `Midst Setup ${VERSION}.exe`,
    linux: `Midst-${VERSION}.AppImage`,
  };
  Object.entries(installers).forEach(([pl, name]) => {
    const art = path.join(
      tmp,
      pl === 'macos' && macName ? macName : `midst-${pl}-${VERSION}-${COMMIT}`
    );
    fs.mkdirSync(art, { recursive: true });
    const bytes = Buffer.from(`${pl} installer`);
    fs.writeFileSync(path.join(art, name), bytes);
    const info = {
      platform: pl,
      version: VERSION,
      commit: COMMIT,
      ref: 'refs/heads/main',
      signed: true,
      notarised: true,
      files: [
        {
          name,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        },
      ],
    };
    if (pl in audition) info.colourAudition = audition[pl];
    const bi = path.join(tmp, `build-info-${pl}`);
    fs.mkdirSync(bi, { recursive: true });
    fs.writeFileSync(path.join(bi, `${pl}.json`), JSON.stringify(info));
  });
}

function verify(opts) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-candidate-'));
  try {
    download(tmp, opts);
    return spawnSync('bash', [SCRIPT, tmp, COMMIT], { encoding: 'utf8' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('verify_candidate.sh and audition builds', () => {
  test('a build-info without the field (from before the audition) is releasable', () => {
    const r = verify();
    expect(r.stderr).toContain(`releasable: ${VERSION}`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(VERSION);
  });

  test('colourAudition false on every platform is releasable', () => {
    const r = verify({
      audition: { macos: false, windows: false, linux: false },
    });
    expect(r.status).toBe(0);
  });

  test.each([
    ['macos', true],
    ['windows', true],
    ['linux', true],
    ['macos', 'true'],
    ['linux', null],
  ])('colourAudition on %s = %p is refused', (pl, value) => {
    const r = verify({ audition: { [pl]: value } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`not releasable: ${pl} is an audition build`);
  });

  test('an artifact named for an audition is refused even if build-info says nothing', () => {
    const r = verify({
      macName: `midst-macos-${VERSION}-colour-audition-${COMMIT}`,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is an audition build (View > Colours…)');
  });
});
