// jest's globalSetup. It runs the shared hooks check (tools/require-hooks.cjs, the same file in every midst
// repository), then compiles the message catalog, so every jest run, however it was started, reads the
// words as they are in locales/<lang>/messages.po now and never a missing or older compiled copy.
const path = require('path');
const { execFileSync } = require('child_process');
const requireHooks = require('./require-hooks.cjs');

const root = path.join(__dirname, '..');

module.exports = async () => {
  await requireHooks();
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
