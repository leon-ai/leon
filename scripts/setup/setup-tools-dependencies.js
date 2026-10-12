import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_TOOLS_PATH, TOOLS_PATH } from '@/constants'

import { createSetupStatus } from './setup-status'
import { SetupUI } from './setup-ui'
import {
  syncNodejsSourceDependencies,
  syncPythonSourceDependencies
} from './sync-source-dependencies'

const NODEJS_SOURCE_PATH = path.join('src', 'nodejs')
const PYTHON_SOURCE_PATH = path.join('src', 'python')

const getToolPaths = async (toolsPath) => {
  if (!fs.existsSync(toolsPath)) {
    return []
  }

  const toolkitEntries = await fs.promises.readdir(toolsPath, {
    withFileTypes: true
  })
  const toolPaths = []

  for (const toolkitEntry of toolkitEntries) {
    if (!toolkitEntry.isDirectory()) {
      continue
    }

    const toolkitPath = path.join(toolsPath, toolkitEntry.name)
    const toolEntries = await fs.promises.readdir(toolkitPath, {
      withFileTypes: true
    })

    for (const toolEntry of toolEntries) {
      if (!toolEntry.isDirectory()) {
        continue
      }

      const toolPath = path.join(toolkitPath, toolEntry.name)
      if (!fs.existsSync(path.join(toolPath, 'tool.json'))) {
        continue
      }

      toolPaths.push(toolPath)
    }
  }

  return toolPaths
}

/**
 * Sync tool dependencies next to each tool source folder.
 */
export default async function setupToolsDependencies() {
  const status = createSetupStatus('Setting up tool dependencies...').start()

  try {
    const toolPaths = [
      ...(await getToolPaths(TOOLS_PATH)),
      ...(await getToolPaths(PROFILE_TOOLS_PATH))
    ]

    for (const [index, toolPath] of toolPaths.entries()) {
      const toolName = path.join(
        path.basename(path.dirname(toolPath)),
        path.basename(toolPath)
      )
      const progress = `Tool dependencies (${index + 1}/${toolPaths.length}): ${toolName}`
      const getInstallOptions = (language) => ({
        stdio: ['ignore', 'inherit', 'inherit'],
        onInstall() {
          // Installer output owns the terminal while downloads and builds run.
          status.pause()
          SetupUI.aside(`${progress} — installing ${language} dependencies...`)
        }
      })

      status.text = `${progress} — checking...`
      status.start()

      for (const sourceFolder of [NODEJS_SOURCE_PATH, PYTHON_SOURCE_PATH]) {
        const sourcePath = path.join(toolPath, sourceFolder)

        // A Node.js wrapper may depend on a Python CLI; manifests determine what to install.
        await syncNodejsSourceDependencies(
          sourcePath,
          getInstallOptions('Node.js')
        )
        await syncPythonSourceDependencies(
          sourcePath,
          getInstallOptions('Python')
        )
      }
    }

    status.succeed('Tool dependencies: ready')
  } catch (e) {
    status.fail('Failed to set up tool dependencies')
    throw e
  }
}
