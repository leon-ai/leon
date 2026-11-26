import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.mjs',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45_000,
  outputDir: '../.artifacts/e2e',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
