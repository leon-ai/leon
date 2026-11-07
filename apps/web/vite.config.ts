import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { defineConfig, normalizePath, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { tsImport } from 'tsx/esm/api'
import YAML from 'yaml'

import { PROFILE_CONFIG_PATH } from '../../server/src/leon-roots.ts'
import type { ModelProvider } from './src/data/model-catalog.ts'

const WEB_APP_DEV_SERVER_PORT = 5_173
const HIGHLIGHTS_WASM_MODULE_ID = '\0leon:highlights-wasm'
const require = createRequire(import.meta.url)
const highlightsPackageURL = pathToFileURL(require.resolve('@pierre/highlights/package.json'))
const highlightsPackage = JSON.parse(fs.readFileSync(highlightsPackageURL, 'utf8')) as {
  exports: { '.': { workerd: string } }
}
const highlightsEntryURL = new URL(highlightsPackage.exports['.'].workerd, highlightsPackageURL)
const highlightsEntryPath = normalizePath(fileURLToPath(highlightsEntryURL))
const highlightsWasmPath = normalizePath(fileURLToPath(new URL('./highlights.wasm', highlightsEntryURL)))

/**
 * Uses Pierre's native-Wasm entry in both browsers and workers without shipping
 * base64 bytes or changing its synchronous tokenizer API after initialization.
 */
function nativeHighlightsWasm(): Plugin {
  return {
    name: 'native-highlights-wasm',
    enforce: 'pre',
    resolveId(source, importer): string | undefined {
      // Development prebundling resolves the binary before the import reaches
      // this hook; production imports it relative to the package entry.
      if (source === highlightsWasmPath ||
        (source === './highlights.wasm' && importer === highlightsEntryPath)) {
        return HIGHLIGHTS_WASM_MODULE_ID
      }
      return undefined
    },
    load(id): string | undefined {
      if (id !== HIGHLIGHTS_WASM_MODULE_ID) {
        return undefined
      }

      return `import url from ${JSON.stringify(`${highlightsWasmPath}?url`)};
export default await (async () => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('I could not load the syntax engine.');
  }
  if (typeof WebAssembly.compileStreaming === 'function' &&
      response.headers.get('content-type')?.startsWith('application/wasm')) {
    return WebAssembly.compileStreaming(response);
  }
  return WebAssembly.compile(await response.arrayBuffer());
})();`
    }
  }
}

interface LeonServerConfig {
  host: string
  port: number
}

interface ModelCatalogModule {
  getPublicModelCatalog: () => ModelProvider[]
}

async function readModelProviders(): Promise<ModelProvider[]> {
  // Resolve Core's aliases only in the build process, not through the web app's
  // identically named alias. Serialize just the public selector metadata.
  const options = {
    parentURL: import.meta.url,
    tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url))
  }
  const catalog = await tsImport(
    '../../server/src/core/llm-manager/public-model-catalog.ts',
    options
  ) as ModelCatalogModule

  return catalog.getPublicModelCatalog()
}

function readLeonServerConfig(): LeonServerConfig {
  if (!fs.existsSync(PROFILE_CONFIG_PATH)) {
    throw new Error(`Profile config file not found at "${PROFILE_CONFIG_PATH}".`)
  }
  const config = YAML.parse(fs.readFileSync(PROFILE_CONFIG_PATH, 'utf8')) as {
    server?: Partial<LeonServerConfig>
  }
  if (typeof config.server?.host !== 'string' || !Number.isInteger(config.server.port)) {
    throw new Error(`Profile config file "${PROFILE_CONFIG_PATH}" must define server.host and server.port.`)
  }

  return { host: config.server.host, port: config.server.port as number }
}

export default defineConfig(async ({ command, mode, isPreview }) => {
  // Only the development proxy needs backend configuration. Static builds and
  // isolated previews remain independent of any owner profile or live server.
  const leonServer = command === 'serve' && !isPreview ? readLeonServerConfig() : undefined

  return {
    root: 'apps/web',
    base: leonServer ? '/' : '/web-app/',
    define: {
      LEON_MODEL_PROVIDERS: JSON.stringify(await readModelProviders())
    },
    resolve: {
      alias: [
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        { find: /^@pierre\/highlights$/, replacement: highlightsEntryPath },
        // The fallback uses a small lazy grammar catalog, not Shiki's full bundle.
        {
          find: /^shiki\/langs$/,
          replacement: fileURLToPath(new URL('./src/components/code-view/fallback-languages.ts', import.meta.url))
        },
        // Keep optional Wasm as a native binary instead of base64 JavaScript.
        {
          find: /^shiki\/wasm$/,
          replacement: `${createRequire(import.meta.url).resolve('shiki/onig.wasm')}?init`
        }
      ]
    },
    build: {
      ...(mode === 'development' ? { minify: false, sourcemap: true } : {}),
      outDir: 'dist',
      emptyOutDir: true,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                // Shared UI helpers must not make the shell import Markdown.
                name: 'ui-runtime',
                test: (id: string): boolean => id.includes('/node_modules/clsx/') || id.includes('vite/preload-helper'),
                includeDependenciesRecursively: false,
                priority: 40
              },
              {
                name: 'markdown-math-engine',
                test: /node_modules\/katex\//,
                includeDependenciesRecursively: false,
                priority: 30
              },
              {
                name: 'markdown-math-parser',
                test: /node_modules\/(?:@streamdown\/math|remark-math|rehype-katex|micromark-extension-math|mdast-util-math)\//,
                includeDependenciesRecursively: false,
                priority: 30
              },
              {
                name: 'markdown-parser',
                test: /node_modules\/(?:marked|unified|remark-[^/]+|micromark[^/]*|mdast-[^/]+)\//,
                priority: 16
              },
              {
                name: 'markdown-vendor',
                test: /node_modules\/(?:streamdown|marked|remend|unified|remark-[^/]+|rehype-[^/]+|micromark[^/]*|mdast-[^/]+|hast-[^/]+|unist-[^/]+)\//,
                priority: 15
              },
              {
                name: 'react-vendor',
                test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
                priority: 20
              },
              {
                name: 'tanstack-vendor',
                test: /node_modules[\\/]@tanstack[\\/]/,
                priority: 10
              }
            ]
          }
        }
      }
    },
    ...(leonServer ? {
      server: {
        port: WEB_APP_DEV_SERVER_PORT,
        proxy: {
          '/api': { target: `${leonServer.host}:${leonServer.port}`, changeOrigin: true }
        }
      }
    } : {}),
    worker: { format: 'es' as const, plugins: (): Plugin[] => [nativeHighlightsWasm()] },
    plugins: [nativeHighlightsWasm(), react()]
  }
})
