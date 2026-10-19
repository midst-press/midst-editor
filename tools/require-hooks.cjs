// jest's globalSetup: the tests do not run in a clone whose git hooks are missing.
// See tools/install-hooks.cjs for why, and for the two cases (CI, not a clone) where this passes.
//
// It also compiles the message catalog, so every jest run, however it was started, reads the words
// as they are in locales/<lang>/messages.po now and never a missing or older compiled copy.
const path = require('path');
const { execFileSync } = require('child_process');
const { ensureHooks } = require('./install-hooks.cjs');

const root = path.join(__dirname, '..');

module.exports = async () => {
  const result = ensureHooks(root, { checkOnly: true });
  if (!result.ok) throw new Error(result.message);
  // The CLI's bin entry, run by this node. Named by path: the package's `exports` exposes neither
  // the bin nor package.json to require.resolve.
  const lingui = path.join(
    root,
    'node_modules',
    '@lingui',
    'cli',
    'dist',
    'lingui.js'
  );
  execFileSync(process.execPath, [lingui, 'compile'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
};
