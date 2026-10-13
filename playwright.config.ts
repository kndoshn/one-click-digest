// End-to-end tests: load the E2E build of the extension (build/e2e, from `npm run build:e2e`) into
// Chromium and drive the overlay on fixture pages, with the Claude API mocked. See e2e/.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // One browser per test file (extensions need a persistent context); tests in a file run in order.
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure'
  }
});
