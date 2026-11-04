// Where the user guide (docs/user-guide.md) can be read. The About box and Help > Documentation
// open it in the poet's browser.
//
// Points to midst.press/app (GitHub #111): the app must not link to GitHub. The guide on the site
// is kept current; a packaged app's release tag no longer needs to appear in the URL.
const GUIDE_AT = 'https://midst.press/app';

/** The user guide on midst.press. */
export const userGuideUrl = (): string => GUIDE_AT;

export default userGuideUrl;
