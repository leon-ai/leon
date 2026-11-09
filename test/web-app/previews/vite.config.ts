import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { auroraSandbox } from '../../../apps/web/vite/aurora-sandbox.ts'

// Design studies use real app components, without profile configuration or API access.
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../../apps/web/public', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../node_modules/.cache/vite-web-previews', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../../apps/web/src', import.meta.url)) }
  },
  server: { port: 5_174, strictPort: true },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{
            // The gallery has fewer shared consumers than the app; retain the
            // same lazy chart boundary without combining its renderer and engine.
            name: 'chart-renderer',
            test: /node_modules\/zrender\//,
            includeDependenciesRecursively: true,
            priority: 20
          }]
        }
      },
      input: {
        icons: fileURLToPath(new URL('./icons.html', import.meta.url)),
        aurora: fileURLToPath(new URL('./aurora.html', import.meta.url))
      }
    }
  },
  plugins: [auroraSandbox(), react()]
})
