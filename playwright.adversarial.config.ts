import { defineConfig, devices } from '@playwright/test';

/**
 * Adversarial QA suite config (tests/adversarial/). Kept separate from playwright.config.ts so the
 * Phase 0 smoke gate stays exactly the 7 tests in e2e/. These tests are reviewer-written attacks and
 * are not part of the builder's gate.
 *
 * Run: npx playwright test --config playwright.adversarial.config.ts
 * The Attack 2/3/5/6 tests also need a production preview on port 4173:
 *   npx vite build && npx vite preview --port 4173
 * They skip (and are reported as skipped) when it is not running.
 */
export default defineConfig({
  testDir: 'tests/adversarial',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
