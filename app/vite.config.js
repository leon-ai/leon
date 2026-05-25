import dns from 'node:dns'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import YAML from 'yaml'

import {
  PROFILE_CONFIG_PATH,
  PROFILE_DOT_ENV_PATH
} from '../server/src/leon-roots.ts'

const APP_DEV_SERVER_PORT = 5_173

dotenv.config({ path: PROFILE_DOT_ENV_PATH })

dns.setDefaultResultOrder('verbatim')

function readAppLeonConfig() {
  if (!fs.existsSync(PROFILE_CONFIG_PATH)) {
    throw new Error(`Profile config file not found at "${PROFILE_CONFIG_PATH}".`)
  }

  const config = YAML.parse(fs.readFileSync(PROFILE_CONFIG_PATH, 'utf8'))
  const server = config?.server

  if (
    !server ||
    typeof server.host !== 'string' ||
    !Number.isInteger(server.port)
  ) {
    throw new Error(
      `Profile config file "${PROFILE_CONFIG_PATH}" must define server.host and server.port.`
    )
  }

  return {
    host: server.host,
    port: server.port
  }
}

// Map necessary Leon's env vars as Vite only expose VITE_*
const leonConfig = readAppLeonConfig()
process.env.VITE_LEON_NODE_ENV = process.env.LEON_NODE_ENV
process.env.VITE_LEON_HOST = leonConfig.host
process.env.VITE_LEON_PORT = String(leonConfig.port)

export default defineConfig({
  root: 'app/src',
  resolve: {
    alias: [
      {
        find: '@aurora/style.css',
        replacement: fileURLToPath(
          new URL('../aurora/style.css', import.meta.url)
        )
      },
      {
        find: '@aurora',
        replacement: fileURLToPath(
          new URL('../aurora/src/index.ts', import.meta.url)
        )
      }
    ]
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: APP_DEV_SERVER_PORT
  },
  plugins: [react()]
})
