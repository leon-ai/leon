import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const AURORA_PREVIEW_DEV_SERVER_PORT = 5_175

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      {
        find: '@aurora/style.css',
        replacement: fileURLToPath(new URL('../style.css', import.meta.url))
      },
      {
        find: '@aurora',
        replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url))
      }
    ]
  },
  server: {
    port: AURORA_PREVIEW_DEV_SERVER_PORT
  },
  plugins: [react()]
})
