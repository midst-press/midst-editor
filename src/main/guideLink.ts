import { app } from 'electron';
import { userGuideUrl } from '../shared/userGuide';

// The user guide for the running app: its release tag when packaged, main when run from source (#102).
const installedGuideUrl = (): string =>
  userGuideUrl(app.isPackaged ? app.getVersion() : null);

export default installedGuideUrl;
