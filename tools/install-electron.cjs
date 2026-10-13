#!/usr/bin/env node
// Puts a runnable Electron in node_modules/electron, for `npm run e2e` and `npm start`. Issue #8.
//
//     node tools/install-electron.cjs      (also runs before `npm run e2e`)
//
// Why this exists. Electron's own install script (node_modules/electron/install.js) does not finish
// on the Node this project pins: it unpacks with extract-zip 2.0.1, whose promise never settles on
// Node 26, so the process ends with exit status 0 after two of the 255 files and writes no path.txt.
// `require('electron')` then throws "Electron failed to install correctly". npm 12 also skips that
// script unless it is allowed, but allowing it would not help: run by hand it fails the same way.
//
// What this does instead: the same download, through the same @electron/get with the same
// checksums.json that ships inside the electron package, then unpacks with the operating system's
// own tool and writes path.txt as install.js would. It changes nothing when Electron is already
// complete, so it is safe to run every time.
//
// Exit 0: Electron is installed and its executable exists. Exit 1: it is not, with the reason.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PLATFORM_PATHS = {
  darwin: 'Electron.app/Contents/MacOS/Electron',
  mas: 'Electron.app/Contents/MacOS/Electron',
  freebsd: 'electron',
  openbsd: 'electron',
  linux: 'electron',
  win32: 'electron.exe',
};

function installed(electronDir, version, platformPath) {
  try {
    return (
      fs.readFileSync(path.join(electronDir, 'dist', 'version'), 'utf8').replace(/^v/, '').trim() === version &&
      fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8') === platformPath &&
      fs.existsSync(path.join(electronDir, 'dist', platformPath))
    );
  } catch (missing) {
    return false;
  }
}

// The operating system's own unpacker: none of them depends on the Node version.
function unpack(zipPath, dir, platform) {
  if (platform === 'darwin' || platform === 'mas') {
    // ditto keeps the symbolic links inside the frameworks, which the app needs.
    execFileSync('ditto', ['-x', '-k', zipPath, dir], { stdio: 'inherit' });
  } else if (platform === 'win32') {
    // tar.exe ships with Windows 10 and later and reads zip archives.
    execFileSync('tar', ['-xf', zipPath, '-C', dir], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', dir], { stdio: 'inherit' });
  }
}

async function main() {
  const electronDir = path.dirname(require.resolve('electron/package.json'));
  const { version } = require(path.join(electronDir, 'package.json'));
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const platformPath = PLATFORM_PATHS[platform];
  if (!platformPath) throw new Error(`Electron has no build for platform ${platform}`);

  if (installed(electronDir, version, platformPath)) {
    console.log(`electron ${version} is already installed (${platform}-${arch})`);
    return;
  }

  // @electron/get is a dependency of electron itself, so resolve it from there.
  const { downloadArtifact } = require(require.resolve('@electron/get', { paths: [electronDir] }));
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform,
    arch,
    checksums: require(path.join(electronDir, 'checksums.json')),
  });

  const dist = path.join(electronDir, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.rmSync(path.join(electronDir, 'path.txt'), { force: true });
  fs.mkdirSync(dist, { recursive: true });
  unpack(zipPath, dist, platform);

  // path.txt last, and only when the unpacked tree is what was asked for: it is what marks the
  // install as complete, to this script and to require('electron').
  const unpacked = fs.readFileSync(path.join(dist, 'version'), 'utf8').replace(/^v/, '').trim();
  if (unpacked !== version) throw new Error(`unpacked Electron says version ${unpacked}, expected ${version}`);
  if (!fs.existsSync(path.join(dist, platformPath))) throw new Error(`no ${platformPath} in the unpacked Electron`);
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath);
  console.log(`electron ${version} installed (${platform}-${arch})`);
}

main().catch((error) => {
  console.error(`install-electron: ${error.message}`);
  process.exit(1);
});
