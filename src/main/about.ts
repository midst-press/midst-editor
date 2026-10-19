import { BrowserWindow, app, clipboard, dialog, shell } from 'electron';
import { buildLabel } from '../shared/buildLabel';
import installedGuideUrl from './guideLink';
import { i18n } from '../shared/i18n';

// The commit and its date are written into the bundle when it is built
// (.erb/scripts/build-identity.js, through webpack.config.main.prod.ts). Running from source
// (npm start) has neither, and is a development build.
//
// The version is the installed package's own (release/app/package.json). The release workflow
// tags the built commit v<that version>, so "v" plus the version is the release tag.
export const aboutLine = (): string =>
  app.isPackaged
    ? buildLabel({
        tag: `v${app.getVersion()}`,
        commit: process.env.MIDST_BUILD_COMMIT,
        committedAt: process.env.MIDST_BUILD_COMMITTED_AT,
      })
    : buildLabel({});

// Who made Midst, shown under the version line, one name to a line. It is one message, names and all,
// so the journal's editor can change any of it.
export const credits = (): string => i18n._('dialog.about.credits');

// A message box's text cannot be selected on every platform, so Copy puts the line on the
// clipboard for pasting into a report.
// User Guide opens docs/user-guide.md in the browser.
export const showAbout = async (mainWindow: BrowserWindow): Promise<void> => {
  const line = aboutLine();
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: i18n._('dialog.about.title'),
    message: i18n._('dialog.about.message'),
    detail: `${line}\n\n${credits()}`,
    buttons: [
      i18n._('button.ok'),
      i18n._('dialog.about.copy'),
      i18n._('dialog.about.userGuide'),
    ],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === 1) clipboard.writeText(line);
  if (response === 2) await shell.openExternal(installedGuideUrl());
};
