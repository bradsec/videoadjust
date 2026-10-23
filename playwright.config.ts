import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // CI shards write blob reports that the e2e-report job merges into one HTML report.
  reporter: process.env.CI ? [['list'], ['blob']] : [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4317', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Phone and tablet run the same WebKit as the webkit project; the app differs there only by
    // CSS breakpoints and touch input, so these projects run just the tests tagged @mobile.
    { name: 'iphone', use: { ...devices['iPhone 15'] }, grep: /@mobile/ },
    { name: 'ipad', use: { ...devices['iPad Pro 11'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `${process.env.CI ? 'pnpm exec vite build' : 'pnpm build'} && pnpm preview --port 4317 --strictPort`,
    url: 'http://127.0.0.1:4317',
    reuseExistingServer: false,
    env: { VA_E2E: '1' },
  },
});
