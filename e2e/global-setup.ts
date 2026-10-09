import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

// Prepare the built app so Playwright can launch it directly.
//
// WHY THIS IS NEEDED. main.ts:107 chooses the preload path on `app.isPackaged`:
//
//   preload: app.isPackaged ? join(__dirname, 'preload.js')
//                           : join(__dirname, '../../.erb/dll/preload.js')
//
// Launching the BUILT but UNPACKAGED app -- which is what these tests do, because packaging with
// electron-builder is slow and wants signing configuration -- leaves `isPackaged` false. So the app
// looks for a development preload at release/app/.erb/dll/preload.js, which `npm run build` never
// creates. Without it the preload fails to load, `window.electron` is undefined, the renderer throws
// `Cannot read properties of undefined (reading 'ipcRenderer')`, and React never mounts: the window
// sits on the index.html placeholder. Nothing about that is visible from reading the source.
//
// The production preload is already built beside the main bundle, so it is placed where this launch
// mode expects it. Same bytes, no second build.
//
// ⚠️ This is a property of launching unpackaged, not a defect in the app -- packaged builds resolve
// the first branch and are fine.

export default function globalSetup() {
  const appDir = resolve(__dirname, '..', 'release', 'app');
  const built = join(appDir, 'dist', 'main', 'preload.js');
  const wanted = join(appDir, '.erb', 'dll', 'preload.js');

  if (!existsSync(built)) {
    throw new Error(
      `The app is not built: ${built} is missing. Run \`npm run build\` before \`npm run e2e\`.`
    );
  }
  mkdirSync(dirname(wanted), { recursive: true });
  copyFileSync(built, wanted);

  if (!existsSync(join(appDir, 'dist', 'renderer', 'renderer.js'))) {
    throw new Error(
      'The renderer is not built. Run `npm run build` before `npm run e2e`.'
    );
  }
}
