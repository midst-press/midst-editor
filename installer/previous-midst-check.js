// Installer JavaScript (issue 16). tools/installer_distribution.cjs puts this file, unchanged,
// into the package's Distribution, after a line defining MIDST_INSTALLING_VERSION (the version
// this package installs). There macOS Installer runs it with its own `system` and `my` objects.
// It is not part of the app.
//
// It decides "is there an older Midst?" by the same rule as installer/pkg-scripts/preinstall,
// which is what actually renames it: "Midst Beta.app", or a "Midst.app" that is not this very
// release (bundle id press.Midst.MidstApp at exactly MIDST_INSTALLING_VERSION). Any other release
// of ours, lower or higher, counts as older. The tests hold the two to the same answers.

/* global system, my, MIDST_INSTALLING_VERSION */

const MIDST_APPLICATIONS = '/Applications';

function midstInstallingVersion() {
  return typeof MIDST_INSTALLING_VERSION === 'string' &&
    /^[0-9A-Za-z.+-]+$/.test(MIDST_INSTALLING_VERSION)
    ? MIDST_INSTALLING_VERSION
    : null;
}

function midstIsThisRelease(path) {
  const installing = midstInstallingVersion();
  if (!installing) return false;
  const info = system.files.bundleAtPath(path);
  if (!info) return false;
  if (info.CFBundleIdentifier !== 'press.Midst.MidstApp') return false;
  return String(info.CFBundleShortVersionString) === installing;
}

function midstPreviousApps() {
  const beta = `${MIDST_APPLICATIONS}/Midst Beta.app`;
  const current = `${MIDST_APPLICATIONS}/Midst.app`;
  const found = [];
  if (system.files.fileExistsAtPath(beta)) found.push(beta);
  if (system.files.fileExistsAtPath(current) && !midstIsThisRelease(current))
    found.push(current);
  return found;
}

// Named in the Distribution: the delete choice's visible="midstHasPrevious()".
function midstHasPrevious() {
  return midstPreviousApps().length > 0;
}

// Named in the Distribution: <installation-check script="midstPreviousCheck()"/>.
// eslint-disable-next-line no-unused-vars
function midstPreviousCheck() {
  if (!midstHasPrevious()) return true;
  my.result.type = 'Warning';
  my.result.title = 'An older version of Midst is in your Applications folder';
  my.result.message =
    'The new Midst will be installed as “Midst”. The older version will be kept and ' +
    'renamed “Midst (previous version)”.\n\n' +
    'To delete the older version instead, click Customize at the Installation Type step and tick ' +
    '“Delete the older version of Midst”.';
  return false;
}
