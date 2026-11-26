import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import YAML from 'yaml'

const BROWSER_TOOLKIT = 'browser_use'
const BROWSER_TOOL = 'browser-use'
const BROWSER_BINDING = BROWSER_TOOLKIT + '.' + BROWSER_TOOL
const CORE_HOST = '$core'

/**
 * Keep established CDP endpoints available to the Core profile that owns them.
 * An existing owner device assignment takes precedence over this default.
 */
export default async function migrate(profilePaths) {
  const activeSettings = path.join(profilePaths.tools, BROWSER_TOOLKIT, BROWSER_TOOL, 'settings.json')
  const settings = await fs.readFile(activeSettings, 'utf8').then(JSON.parse).catch((error) => {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return {}
  })
  if (typeof settings.cdp_endpoint !== 'string' || !settings.cdp_endpoint.trim()) {
    return
  }

  const source = await fs.readFile(profilePaths.config, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return ''
  })
  const document = YAML.parseDocument(source || '{}')
  if (document.errors.length) {
    throw document.errors[0]
  }
  const key = ['satellite', 'tools', BROWSER_BINDING]
  if (document.hasIn(key)) {
    return
  }
  document.setIn(key, CORE_HOST)
  const pending = profilePaths.config + '.' + randomUUID() + '.tmp'
  try {
    await fs.writeFile(pending, document.toString(), { mode: 0o600 })
    await fs.rename(pending, profilePaths.config)
  } finally {
    await fs.rm(pending, { force: true })
  }
}
