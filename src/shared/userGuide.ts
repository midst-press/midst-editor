// Where the user guide (docs/user-guide.md) can be read. The About box and Help > Documentation
// open it in the poet's browser.
//
// The guide as it was for the installed version (#102): a packaged app links to its release tag,
// v<version>, which the release workflow pushes for every build it hands out (see aboutLine). The guide
// on main can describe buttons an older version doesn't have. A development build, which has no
// release tag, links to main.
const GUIDE_AT = 'https://github.com/midst-press/midst-editor/blob';

/** The guide for an app of `version`, or the guide on main when there is no release version. */
export const userGuideUrl = (version: string | null): string =>
  `${GUIDE_AT}/${version ? `v${version}` : 'main'}/docs/user-guide.md`;

export default userGuideUrl;
