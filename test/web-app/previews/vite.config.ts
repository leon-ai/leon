import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Design studies use real app components, without profile configuration or API access.
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../../apps/web/public', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../node_modules/.cache/vite-web-previews', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../../apps/web/src', import.meta.url)) }
  },
  server: { port: 5_174, strictPort: true },
  plugins: [react()]
})
