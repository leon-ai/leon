import { fileURLToPath } from 'node:url'
import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { auroraSandbox } from '../../../apps/web/vite/aurora-sandbox.ts'
import { createConnectionPreview } from '../../fixtures/connection-preview.ts'

const TOOLS_ROOT = fileURLToPath(new URL('../../../tools/', import.meta.url))
// Discover metadata at build time so the browser never loads tool implementations
// or the full function schemas merely to populate the connection chooser.
const CONNECTIONS = [...globSync('*/*/tool.json', { cwd: TOOLS_ROOT })].flatMap((file) => {
  const preview = createConnectionPreview(JSON.parse(readFileSync(path.join(TOOLS_ROOT, file), 'utf8')))

  return preview ? [preview] : []
}).sort((left, right) => left.name.localeCompare(right.name))

// Design studies use real app components, without profile configuration or API access.
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../../apps/web/public', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../node_modules/.cache/vite-web-previews', import.meta.url)),
  define: { AURORA_CONNECTION_PREVIEWS: JSON.stringify(CONNECTIONS) },
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
