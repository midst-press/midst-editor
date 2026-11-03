// Adds the older-Midst handling (issue 16) to the Distribution file electron-builder generates
// for the macOS package. electron-builder 26 exposes no option for an installation check or an
// extra choice, so tools/finish_pkg.sh expands the built package, rewrites its Distribution with
// this, and rebuilds it.
//
//     node tools/installer_distribution.cjs <Distribution in> <Distribution out> <version>
//
// Every edit asserts the text it replaces occurs exactly once, so a change in what electron-builder
// generates stops the build here instead of producing a package without the warning or the choice.

const fs = require('fs');
const path = require('path');

const APP_ID = 'press.Midst.MidstApp';
const REMOVE_ID = `${APP_ID}.remove-previous`;
const CHECK_JS = path.join(
  __dirname,
  '..',
  'installer',
  'previous-midst-check.js'
);

const REMOVE_TITLE = 'Delete the older version of Midst';
const REMOVE_DESCRIPTION =
  'PERMANENTLY deletes the older version of Midst after the new one is installed. ' +
  'It does not go to the Trash and cannot be undone. ' +
  'Leave this unticked to keep it as “Midst (previous version)”.';

function once(xml, pattern, what) {
  const hits = xml.match(new RegExp(pattern.source, 'g')) || [];
  if (hits.length !== 1) {
    throw new Error(
      `Distribution: expected exactly one ${what}, found ${hits.length}`
    );
  }
  return hits[0];
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function editDistribution(xml, checkJs, version) {
  if (xml.includes(REMOVE_ID))
    throw new Error('Distribution: already has the older-Midst choice');
  if (checkJs.includes(']]>'))
    throw new Error('installer script cannot contain "]]>"');
  if (!/^[0-9A-Za-z.+-]+$/.test(version))
    throw new Error(`unexpected version "${version}"`);

  // Customize must be offered, or the opt-in choice can never be ticked.
  const options = once(xml, /<options [^>]*\/>/, '<options>');
  if (!/customize="never"/.test(options)) {
    throw new Error(
      `Distribution: <options> no longer says customize="never": ${options}`
    );
  }
  let out = xml.replace(options, () =>
    options.replace('customize="never"', 'customize="allow"')
  );

  // The new app is always installed: its choice is shown ticked and cannot be unticked.
  const appChoice = once(
    out,
    /<choice id="default"[^>]*\/>/,
    'default <choice>'
  );
  out = out.replace(appChoice, () =>
    appChoice.replace(/\/>$/, ' enabled="false"/>')
  );

  // The delete choice comes AFTER the app in the outline, so it runs only once the app is in.
  const outlineEnd = once(out, /<\/choices-outline>/, '</choices-outline>');
  out = out.replace(
    outlineEnd,
    () => `    <line choice="${REMOVE_ID}"/>\n    ${outlineEnd}`
  );

  const added = [
    `    <installation-check script="midstPreviousCheck()"/>`,
    `    <script><![CDATA[\n${checkJs}\n]]></script>`,
    `    <choice id="${REMOVE_ID}" title="${escapeXml(REMOVE_TITLE)}" description="${escapeXml(REMOVE_DESCRIPTION)}"` +
      ` start_selected="false" visible="midstHasPrevious()">`,
    `        <pkg-ref id="${REMOVE_ID}"/>`,
    `    </choice>`,
    `    <pkg-ref id="${REMOVE_ID}" version="${version}" onConclusion="none">${REMOVE_ID}.pkg</pkg-ref>`,
  ].join('\n');
  const end = once(out, /<\/installer-gui-script>/, '</installer-gui-script>');
  return out.replace(end, () => `${added}\n${end}`);
}

function main(argv) {
  if (argv.length !== 3) {
    process.stderr.write(
      'usage: installer_distribution.cjs <Distribution in> <Distribution out> <version>\n'
    );
    return 2;
  }
  const [input, output, version] = argv;
  const xml = fs.readFileSync(input, 'utf8');
  fs.writeFileSync(
    output,
    editDistribution(xml, fs.readFileSync(CHECK_JS, 'utf8'), version)
  );
  return 0;
}

module.exports = {
  editDistribution,
  APP_ID,
  REMOVE_ID,
  REMOVE_TITLE,
  REMOVE_DESCRIPTION,
  CHECK_JS,
};

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`installer_distribution: ${error.message}\n`);
    process.exit(1);
  }
}
