// Installer JavaScript (issue 16). tools/installer_distribution.cjs puts this file, unchanged,
// into the package's Distribution, where macOS Installer runs it with its own `system` and `my`
// objects. It is not part of the app.
//
// It decides "is there an older Midst?" by the same rule as installer/pkg-scripts/preinstall,
// which is what actually renames it: any "Midst Beta.app" or "Midst.app" in Applications,
// whatever is inside it, including our own releases at any version, even the one being installed.
// The warning names each app by the version it has, read by the same rule the preinstall uses to
// name the kept copy (^[0-9][0-9A-Za-z.+-]*$, else "<stem> (version unknown)"), so the poet sees exactly
// which version would be deleted. The file name it is kept under, including any " (2)", is the
// preinstall's alone. The tests hold the two to the same answers.

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

// The version an installed app reports, if it is one the preinstall would put in a name.
function midstVersionOf(path) {
  const info = system.files.bundleAtPath(path);
  const version = info ? String(info.CFBundleShortVersionString || '') : '';
  return /^[0-9][0-9A-Za-z.+-]*$/.test(version) ? version : null;
}

// How the warning names an installed app: "Midst 0.9.3", "Midst Beta 0.0.3",
// "Midst (version unknown)".
function midstLabel(path) {
  const name = /Midst Beta\.app$/.test(path) ? 'Midst Beta' : 'Midst';
  const version = midstVersionOf(path);
  return version ? `${name} ${version}` : `${name} (version unknown)`;
}

// Named in the Distribution: the delete choice's visible="midstHasPrevious()".
// eslint-disable-next-line no-unused-vars
function midstHasPrevious() {
  return midstPreviousApps().length > 0;
}

// Named in the Distribution: <installation-check script="midstPreviousCheck()"/>.
// eslint-disable-next-line no-unused-vars
function midstPreviousCheck() {
  const found = midstPreviousApps();
  if (found.length === 0) return true;
  const labels = found.map(midstLabel);
  const names = labels.join(' and ');
  // One sentence per app. Only an app whose version could be read is "renamed to show its
  // version"; the label of one that could not already says "(version unknown)".
  const kept = found
    .map((path, i) =>
      midstVersionOf(path)
        ? `${labels[i]} will be kept, renamed to show its version.`
        : `${labels[i]} will be kept under that name, because its version could not be read.`
    )
    .join(' ');
  my.result.type = 'Warning';
  my.result.title = `${names} ${found.length > 1 ? 'are' : 'is'} already in your Applications folder`;
  my.result.message =
    `The new Midst will be installed as “Midst”. ${kept}\n\n` +
    `To delete ${names} instead, click Customize at the Installation Type step and tick ` +
    '“Delete the Midst that’s already installed”.';
  return false;
}
