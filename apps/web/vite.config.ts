import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import YAML from 'yaml'
import { tsImport } from 'tsx/esm/api'

import { PROFILE_CONFIG_PATH } from '../../server/src/leon-roots.ts'
import type { ModelOption, ModelProvider } from './src/data/model-catalog.ts'

const WEB_APP_DEV_SERVER_PORT = 5_173

interface LeonServerConfig {
  host: string
  port: number
}

interface ModelCatalogModule {
  getLLMModelCatalogProviders: () => string[]
  getLLMModelCatalogEntries: (provider: string) => Array<Omit<ModelOption, 'defaultReasoningLabel' | 'defaultReasoningEffort'>>
  getLLMModelDefaultReasoning: (provider: string, model: string) => {
    label: string
    effort?: ModelOption['defaultReasoningEffort']
  }
}

interface ProviderAccountsModule {
  getLLMProviderAccountConfig: (provider: string) => { label: string } | undefined
}

async function readModelProviders(): Promise<ModelProvider[]> {
  // Resolve Core's aliases only in the build process, not through the web app's
  // identically named alias. Serialize just the public selector metadata.
  const options = {
    parentURL: import.meta.url,
    tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url))
  }
  const catalog = await tsImport(
    '../../server/src/core/llm-manager/llm-model-catalog.ts',
    options
  ) as ModelCatalogModule
  const accounts = await tsImport(
    '../../server/src/core/llm-manager/llm-provider-account-configs.ts',
    options
  ) as ProviderAccountsModule

  return catalog.getLLMModelCatalogProviders().map((provider) => ({
    id: provider,
    label: accounts.getLLMProviderAccountConfig(provider)?.label ?? provider,
    models: catalog.getLLMModelCatalogEntries(provider).map((entry) => {
      const defaultReasoning = catalog.getLLMModelDefaultReasoning(provider, entry.model)

      return {
        model: entry.model,
        label: entry.label,
        recommended: Boolean(entry.recommended),
        reasoning: entry.reasoning,
        speed: entry.speed,
        defaultReasoningLabel: defaultReasoning.label,
        ...(defaultReasoning.effort === undefined ? {} : {
          defaultReasoningEffort: defaultReasoning.effort
        })
      }
    })
  }))
}

function readLeonServerConfig(): LeonServerConfig {
  if (!fs.existsSync(PROFILE_CONFIG_PATH)) {
    throw new Error(`Profile config file not found at "${PROFILE_CONFIG_PATH}".`)
  }

  const config = YAML.parse(
    fs.readFileSync(PROFILE_CONFIG_PATH, 'utf8')
  ) as { server?: Partial<LeonServerConfig> }
  const server = config.server

  if (
    typeof server?.host !== 'string' ||
    !Number.isInteger(server.port)
  ) {
    throw new Error(
      `Profile config file "${PROFILE_CONFIG_PATH}" must define server.host and server.port.`
    )
  }

  return {
    host: server.host,
    port: server.port as number
  }
}

const leonServer = readLeonServerConfig()
process.env['VITE_LEON_HOST'] = leonServer.host
process.env['VITE_LEON_PORT'] = String(leonServer.port)

export default defineConfig(async ({ command }) => ({
  root: 'apps/web',
  base: command === 'build' ? '/web-app/' : '/',
  define: {
    LEON_MODEL_PROVIDERS: JSON.stringify(await readModelProviders())
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
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
  server: {
    port: WEB_APP_DEV_SERVER_PORT
  },
  plugins: [react()]
}))
