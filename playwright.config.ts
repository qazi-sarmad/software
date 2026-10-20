import { defineConfig, devices } from '@playwright/test';

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
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    // S12 (F18): the tutorial drawer autoplays on a screen's first visit. Every E2E context is
    // seeded with the autoplay OFF so existing specs stay deterministic. A dedicated spec clears the
    // key to exercise the autoplay itself. See src/components/common/TutorialButton.tsx.
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://localhost:3000', localStorage: [{ name: 'acp.tutorial.autoplay', value: 'off' }] }],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
