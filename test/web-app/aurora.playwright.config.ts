import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

import webConfig from './playwright.config'

const PORT = 5_187
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  ...webConfig,
  testDir: './aurora',
  // Independent runs must not clear each other's traces or reports.
  outputDir: './aurora/results',
  reporter: [['list'], ['html', { outputFolder: './aurora/report', open: 'never' }]],
  use: { ...webConfig.use, baseURL: BASE_URL },
  webServer: {
    command: `pnpm exec vite build --config test/web-app/previews/vite.config.ts && pnpm exec vite preview --config test/web-app/previews/vite.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: `${BASE_URL}/aurora.html`,
    timeout: 60_000,
    reuseExistingServer: false
  }
})
