import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

const MAXIMUM_WORKERS = 4
const PORT = 5_186

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: Math.min(MAXIMUM_WORKERS, Math.max(1, Math.floor(os.availableParallelism() / 2))),
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  timeout: 30_000,
  outputDir: './results',
  reporter: [['list'], ['html', { outputFolder: './report', open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}/web-app/`,
    viewport: { width: 1_512, height: 982 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'pnpm exec tsx test/web-app/e2e/serve.ts',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: `http://127.0.0.1:${PORT}/web-app/`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: { WEB_APP_TEST_PORT: String(PORT) }
  }
})
