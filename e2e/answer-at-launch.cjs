// Loaded into Midst's main process with --require before the app's own code (crash-recovery.spec.ts), so a message
// box shown while the window is still being set up is answered and recorded rather than left blocking with nobody to
// click it. MIDST_E2E_ANSWER is the button chosen; each message goes to MIDST_E2E_RECORD as a line, and each path
// sent to the Trash as "trash <path>". The Trash itself is never touched.
const { appendFileSync } = require('fs');
const { dialog, shell } = require('electron');

const record = (line) =>
  appendFileSync(process.env.MIDST_E2E_RECORD, `${line}\n`);
dialog.showMessageBoxSync = (_win, opts) => {
  record(`dialog ${(opts && opts.message) || '(no message)'}`);
  return Number(process.env.MIDST_E2E_ANSWER);
};
shell.trashItem = async (p) => record(`trash ${p}`);
