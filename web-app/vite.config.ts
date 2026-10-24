import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const WEB_APP_DEV_SERVER_PORT = 5_173

export default defineConfig({
  root: 'web-app',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: WEB_APP_DEV_SERVER_PORT
  },
  plugins: [react()]
})
