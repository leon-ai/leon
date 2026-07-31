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
const NODE_MODULES_PATH_SEGMENT = '/node_modules/'
const REACT_VENDOR_PACKAGES = ['react', 'react-dom', 'scheduler']
const REALTIME_VENDOR_PACKAGES = [
  'socket.io-client',
  'socket.io-parser',
  'engine.io-client',
  'engine.io-parser'
]
const UI_VENDOR_PACKAGE_PREFIXES = ['@ark-ui/', '@zag-js/', '@floating-ui/']

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

function normalizeModuleId(moduleId) {
  return moduleId.replaceAll('\\', '/')
}

function isNodeModule(moduleId) {
  return normalizeModuleId(moduleId).includes(NODE_MODULES_PATH_SEGMENT)
}

function includesVendorPackage(moduleId, packageName) {
  return normalizeModuleId(moduleId).includes(
    `${NODE_MODULES_PATH_SEGMENT}${packageName}/`
  )
}

function includesVendorPackagePrefix(moduleId, packagePrefix) {
  return normalizeModuleId(moduleId).includes(
    `${NODE_MODULES_PATH_SEGMENT}${packagePrefix}`
  )
}

// Map necessary Leon's env vars as Vite only expose VITE_*
const leonConfig = readAppLeonConfig()
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
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: (moduleId) =>
                REACT_VENDOR_PACKAGES.some((packageName) =>
                  includesVendorPackage(moduleId, packageName)
                ),
              priority: 30
            },
            {
              name: 'realtime-vendor',
              test: (moduleId) =>
                REALTIME_VENDOR_PACKAGES.some((packageName) =>
                  includesVendorPackage(moduleId, packageName)
                ),
              priority: 20
            },
            {
              name: 'ui-vendor',
              test: (moduleId) =>
                UI_VENDOR_PACKAGE_PREFIXES.some((packagePrefix) =>
                  includesVendorPackagePrefix(moduleId, packagePrefix)
                ),
              priority: 10
            },
            {
              name: 'vendor',
              test: isNodeModule,
              priority: 0
            }
          ]
        }
      }
    }
  },
  server: {
    port: APP_DEV_SERVER_PORT
  },
  plugins: [react()]
})
