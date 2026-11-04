import { userGuideUrl } from '../shared/userGuide';

// The user guide on midst.press (#111): no release tag in the URL.
const installedGuideUrl = (): string => userGuideUrl();

export default installedGuideUrl;
