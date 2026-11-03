// Installer JavaScript (issue 16). tools/installer_distribution.cjs puts this file, unchanged,
// into the package's Distribution, where macOS Installer runs it with its own `system` and `my`
// objects. It is not part of the app.
//
// It decides "is there an older Midst?" by the same rule as installer/pkg-scripts/preinstall,
// which is what actually renames it: any "Midst Beta.app" or "Midst.app" in Applications,
// whatever is inside it, including our own releases at any version, even the one being installed.
// The tests hold the two to the same answers.

/* global system, my */

const MIDST_APPLICATIONS = '/Applications';

function midstPreviousApps() {
  const beta = `${MIDST_APPLICATIONS}/Midst Beta.app`;
  const current = `${MIDST_APPLICATIONS}/Midst.app`;
  const found = [];
  if (system.files.fileExistsAtPath(beta)) found.push(beta);
  if (system.files.fileExistsAtPath(current)) found.push(current);
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
