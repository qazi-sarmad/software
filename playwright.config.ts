import { defineConfig, devices } from '@playwright/test';

// G1 anti-theatre gate: with E2E_PROD=1 the suite runs against the built bundle served by
// `vite preview`, never the dev server. The dev server is the default.
const PROD = process.env.E2E_PROD === '1';

/**
 * E2E skeleton. First run on a new machine: `npx playwright install chromium`.
 * The dev server is started automatically (or reused locally if already running).
 *
 * R6d: three browser projects. Normal CI (`.github/workflows/ci.yml` step 7) pins
 * `--project=chromium`. Firefox and WebKit run only from `.github/workflows/browsers.yml`
 * (workflow_dispatch), which installs those engines and passes `--project` for each.
 */
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['github']],
  // The hosted test project answers over the network, so a sign-in and the screen that follows it can
  // take longer than Playwright's 5s default. A short timeout turns a slow response into a flake; a
  // longer one keeps the assertion (the element must still appear) without the noise.
  expect: { timeout: 15_000 },
  use: {
    baseURL: PROD ? 'http://localhost:4173' : 'http://localhost:3000',
    trace: 'retain-on-failure',
    // S12 (F18): the tutorial drawer autoplays on a screen's first visit. Every E2E context is
    // seeded with the autoplay OFF so existing specs stay deterministic. A dedicated spec clears the
    // key to exercise the autoplay itself. See src/components/common/TutorialButton.tsx.
    storageState: {
      cookies: [],
      origins: [{ origin: PROD ? 'http://localhost:4173' : 'http://localhost:3000', localStorage: [{ name: 'acp.tutorial.autoplay', value: 'off' }] }],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
  // The anti-theatre gate (G1) runs the built app, not the dev server. With E2E_PROD=1 the webServer
  // builds the production bundle and serves it with `vite preview`; the dev server is the default so
  // the historical specs keep their fast feedback loop.
  webServer: PROD
    ? {
        command: 'npm run build && npm run preview -- --port 4173 --strictPort',
        url: 'http://localhost:4173',
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
