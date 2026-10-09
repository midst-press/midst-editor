import { defineConfig } from '@playwright/test';

// End-to-end tests that drive the packaged Electron app (issue #12).
//
// Playwright rather than a second e2e stack: midst-web already uses it, and `electronApp.evaluate()`
// runs code in Electron's MAIN process, which is what makes the internal 'app-open' path reachable
// without clicking a native dialog. Note the API is `_electron` -- still underscore-prefixed, so it
// carries no API-stability guarantee.
//
// These require a build first: `npm run build` populates release/app/dist, which is what gets launched.
export default defineConfig({
  testDir: './e2e',
  // Places the preload where an unpackaged launch looks for it; see e2e/global-setup.ts.
  globalSetup: './e2e/global-setup.ts',
  // Electron cold start plus a deliberate settle window per test.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // One app instance at a time: each test launches a real Electron process with its own userData.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
});
