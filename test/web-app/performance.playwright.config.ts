import { defineConfig } from '@playwright/test'

import webConfig from './playwright.config'

// A headed, unthrottled production run uses the normal isolated API fixtures.
// Keep it separate from parallel correctness tests and close other test browsers.
export default defineConfig({
  ...webConfig,
  testDir: './benchmarks',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  outputDir: './benchmarks/results',
  reporter: [['list']],
  use: {
    ...webConfig.use,
    headless: false,
    trace: 'off',
    launchOptions: { args: ['--window-size=1512,982'] }
  },
  projects: [
    { name: 'dpr-1', use: { deviceScaleFactor: 1 } },
    { name: 'dpr-2', use: { deviceScaleFactor: 2 } }
  ]
})
