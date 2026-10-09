const { notarize } = require('@electron/notarize');

// Notarises the signed .app with an App Store Connect TEAM API key (individual keys cannot use
// notarytool). The package workflow writes the .p8 to a temporary file and sets:
//   APPLE_API_KEY         path to AuthKey_<id>.p8
//   APPLE_API_KEY_ID      the key's ID
//   APPLE_API_ISSUER      the team's issuer ID (a UUID)
// Without them, or outside CI, notarisation is skipped and the build says so.
exports.default = async function notarizeMacos(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  if (process.env.CI !== 'true') {
    console.warn('Skipping notarisation: packaging is not running in CI');
    return;
  }

  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env;
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
    console.warn(
      'Skipping notarisation: APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER must all be set'
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleApiKey: APPLE_API_KEY,
    appleApiKeyId: APPLE_API_KEY_ID,
    appleApiIssuer: APPLE_API_ISSUER,
  });

  console.log('Notarisation finished');
};
