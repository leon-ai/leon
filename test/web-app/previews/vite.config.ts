import { fileURLToPath } from 'node:url'
import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
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

/**
 * Keeps real Markdown link artwork available without a Leon server or remote
 * favicon lookup. Only the example website gets this local branding fixture.
 */
function previewFavicons(): Plugin {
  const favicon = readFileSync(new URL('../../../apps/web/public/img/favicon.png', import.meta.url))
  const install = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use('/api/v1/favicons', (request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://preview.local')
      if (request.method !== 'GET' || url.searchParams.get('origin') !== 'https://getleon.ai') {
        next()
        return
      }
      response.setHeader('Content-Type', 'image/png')
      response.setHeader('Cache-Control', 'public, max-age=3600')
      response.end(favicon)
    })
  }

  return { name: 'preview-favicons', configureServer: install, configurePreviewServer: install }
}

// Design studies use real app components, without profile configuration or API access.
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../../apps/web/public', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../node_modules/.cache/vite-web-previews', import.meta.url)),
  define: { AURORA_CONNECTION_PREVIEWS: JSON.stringify(CONNECTIONS) },
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('../../../apps/web/src', import.meta.url)) },
      // Use the app's bounded fallback catalog and native Wasm asset for inspectors.
      { find: /^shiki\/langs$/, replacement: fileURLToPath(new URL('../../../apps/web/src/components/code-view/fallback-languages.ts', import.meta.url)) },
      { find: /^shiki\/wasm$/, replacement: `${createRequire(import.meta.url).resolve('shiki/onig.wasm')}?init` }
    ]
  },
  server: { port: 5_174, strictPort: true },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{
            // Share parsing across feed and Markdown studies without combining
            // the renderer and its full parser graph into one large chunk.
            name: 'markdown-parser',
            test: /node_modules\/(?:marked|unified|remark-[^/]+|micromark[^/]*|mdast-[^/]+)\//,
            priority: 16
          }, {
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
  plugins: [previewFavicons(), auroraSandbox(), react()]
})
