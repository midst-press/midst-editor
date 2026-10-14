import { isPreRelease } from './buildLabel';

// Where "Need Help?" on the opening screen sends the poet (GitHub #63, issue #105). A beta of the
// editor goes to the beta site, a release to the public one. Decided from the app's own version
// (app.getVersion(), which is release/app/package.json), not from a build variable a packager could
// forget to set. A version the rule cannot read counts as a beta, as isPreRelease does for tags.
export const RELEASE_HELP_URL = 'https://www.midst.press/app#help';
export const BETA_HELP_URL = 'https://d1zn50pi7kgz7t.cloudfront.net/app#help';

/** The help page for an app of `version`: the beta site below 1.0.0 or for a pre-release. */
export const helpUrl = (version: string): string =>
  isPreRelease(`v${version}`) ? BETA_HELP_URL : RELEASE_HELP_URL;
