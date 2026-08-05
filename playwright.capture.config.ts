import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Screenshot capture, run on demand: `npm run screenshots`.
 *
 * Shares the main config's web server — a production build against a scratch
 * database — so the images show the app as it is actually served, not as the
 * dev server renders it.
 */
export default defineConfig({
  ...base,
  testMatch: '**/capture.spec.ts',
});
