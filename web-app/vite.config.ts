import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import YAML from 'yaml'

import { PROFILE_CONFIG_PATH } from '../server/src/leon-roots.ts'

const WEB_APP_DEV_SERVER_PORT = 5_173

interface LeonServerConfig {
  host: string
  port: number
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

export default defineConfig(({ command }) => ({
  root: 'web-app',
  base: command === 'build' ? '/web-app/' : '/',
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
