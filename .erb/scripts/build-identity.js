// Which commit a production bundle is built from, for the About box (src/main/about.ts).
// Returns empty strings when git cannot say, and the app then calls itself a development build.
const { execFileSync } = require('child_process');

const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

module.exports = function buildIdentity() {
  try {
    const commit = git('rev-parse', '--short=7', 'HEAD');
    const committedAt = git('log', '-1', '--format=%cI');
    // Tracked files only: packaging leaves untracked build output in the tree.
    let dirty = false;
    try {
      git('diff', '--quiet', 'HEAD');
    } catch {
      dirty = true;
    }
    return { commit: dirty ? `${commit}-dirty` : commit, committedAt };
  } catch {
    return { commit: '', committedAt: '' };
  }
};
