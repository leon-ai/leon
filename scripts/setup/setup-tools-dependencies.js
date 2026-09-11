import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_TOOLS_PATH, TOOLS_PATH } from '@/constants'

import { createSetupStatus } from './setup-status'
import {
  syncNodejsSourceDependencies,
  syncPythonSourceDependencies
} from './sync-source-dependencies'

const NODEJS_SOURCE_PATH = path.join('src', 'nodejs')
const PYTHON_SOURCE_PATH = path.join('src', 'python')

const getToolSourcePaths = async (toolsPath) => {
  if (!fs.existsSync(toolsPath)) {
    return []
  }

  const toolkitEntries = await fs.promises.readdir(toolsPath, {
    withFileTypes: true
  })
  const sourcePaths = []

  for (const toolkitEntry of toolkitEntries) {
    if (!toolkitEntry.isDirectory()) {
      continue
    }

    const toolkitPath = path.join(toolsPath, toolkitEntry.name)
    const toolEntries = await fs.promises.readdir(toolkitPath, {
      withFileTypes: true
    })

    const toolPaths = [
      toolkitPath,
      ...toolEntries.filter((entry) => entry.isDirectory()).map((entry) => path.join(toolkitPath, entry.name))
    ]
    for (const toolPath of toolPaths) {
      if (!fs.existsSync(path.join(toolPath, 'tool.json'))) continue
      sourcePaths.push(path.join(toolPath, NODEJS_SOURCE_PATH), path.join(toolPath, PYTHON_SOURCE_PATH))
    }
  }

  return sourcePaths
}

/**
 * Sync tool dependencies next to each tool source folder.
 */
export default async function setupToolsDependencies() {
  const status = createSetupStatus('Setting up tool dependencies...').start()

  try {
    const sourcePaths = [
      ...(await getToolSourcePaths(TOOLS_PATH)),
      ...(await getToolSourcePaths(PROFILE_TOOLS_PATH))
    ]

    for (const sourcePath of sourcePaths) {
      // A Node.js wrapper may depend on a Python CLI; manifests determine what to install.
      await syncNodejsSourceDependencies(sourcePath)
      await syncPythonSourceDependencies(sourcePath)
    }

    status.succeed('Tool dependencies: ready')
  } catch (e) {
    status.fail('Failed to set up tool dependencies')
    throw e
  }
}
