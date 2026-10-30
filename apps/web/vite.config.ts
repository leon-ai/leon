import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tsImport } from 'tsx/esm/api'
import YAML from 'yaml'

import { PROFILE_CONFIG_PATH } from '../../server/src/leon-roots.ts'
import type { ModelProvider } from './src/data/model-catalog.ts'

const WEB_APP_DEV_SERVER_PORT = 5_173

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
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
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
    plugins: [react()]
  }
})
