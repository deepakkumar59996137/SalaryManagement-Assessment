import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests.
 *
 * Deliberately few. The logic is covered by 232 unit and integration tests that
 * run in eight seconds; what those cannot check is that the pieces are wired
 * together — that a form posts to a route that reaches a service that writes to
 * a database and that the page then shows the result. That is what these do.
 *
 * Kept out of `npm test` so the fast loop stays fast: `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // These tests share one database and change salaries, so they must not race.
  workers: 1,
  forbidOnly: !!process.env.CI,
  /*
   * Smoke only. The capture spec asserts nothing — it writes docs/screenshots —
   * and is run through playwright.capture.config.ts instead. A CLI --grep
   * cannot express this, because config grepInvert and CLI grep both apply.
   */
  testMatch: '**/smoke.spec.ts',
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',

  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * A production build against a scratch database, seeded fresh.
   *
   * Not the dev server: dev recompiles on first hit, which makes the first
   * assertion in a run flaky for reasons that have nothing to do with the app.
   * Not the developer's database either — these tests give people raises.
   */
  webServer: {
    command: 'npm run build && npm run boot && npm start -- --port 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DATABASE_PATH: 'data/e2e.db',
      NODE_ENV: 'production',
    },
  },
});
