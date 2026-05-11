/**
 * Tool runtime for executing Node.js tools.
 * This runtime exists only for Node.js because the core server is built on Node.js
 * and the ReAct loop only needs a single bridge for now.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { Tool } from '@sdk/base-tool'
import {
  TOOLS_PATH
} from '@bridge/constants'
import { setToolReporter } from '@sdk/tool-reporter'

interface ToolRuntimeCliInput {
  toolkitId: string
  toolId: string
  functionName: string
  args: unknown[]
}

const parseArgs = (): ToolRuntimeCliInput => {
  const args = process.argv.slice(2)
  const getValue = (flag: string): string => {
    const index = args.indexOf(flag)
    if (index === -1 || index === args.length - 1) {
      return ''
    }
    return args[index + 1] || ''
  }

  const toolkitId = getValue('--toolkit')
  const toolId = getValue('--tool')
  const functionName = getValue('--function')
  const rawArgs = getValue('--args')

  if (!toolkitId || !toolId || !functionName) {
    throw new Error('Missing required arguments: --toolkit, --tool, --function')
  }

  let parsedArgs: unknown[] = []
  if (rawArgs) {
    const decoded = JSON.parse(rawArgs)
    if (Array.isArray(decoded)) {
      parsedArgs = decoded
    } else if (decoded && typeof decoded === 'object') {
      parsedArgs = Object.values(decoded)
    }
  }

  return {
    toolkitId,
    toolId,
    functionName,
    args: parsedArgs
  }
}

const resolveToolModulePath = (
  toolkitId: string,
  toolId: string
): string | null => {
  const flatBuiltInToolPath = path.join(
    TOOLS_PATH,
    toolkitId,
    toolId,
    'src',
    'nodejs',
    'index.ts'
  )
  if (fs.existsSync(flatBuiltInToolPath)) {
    return flatBuiltInToolPath
  }

  return null
}

const setProjectCwd = (): void => {
  const runtimeDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.join(runtimeDir, '..', '..', '..')
  if (process.cwd() !== projectRoot) {
    process.chdir(projectRoot)
  }
}

const setRuntimeToolReporter = (): void => {
  setToolReporter(async (input) => {
    process.stderr.write(`[LEON_TOOL_REPORT] ${JSON.stringify(input)}\n`)
  })
}

const run = async (): Promise<void> => {
  try {
    setProjectCwd()
    setRuntimeToolReporter()
    const input = parseArgs()
    const toolModulePath = resolveToolModulePath(
      input.toolkitId,
      input.toolId
    )
    if (!toolModulePath) {
      throw new Error(`Tool module not found for ${input.toolId}.`)
    }

    const toolManagerModule = await import('@sdk/tool-manager')
    const ToolManager = toolManagerModule.default
    const isMissingToolSettingsError =
      toolManagerModule.isMissingToolSettingsError
    const toolModule = await import(pathToFileURL(toolModulePath).href)
    const ToolClass = toolModule?.default
    if (!ToolClass) {
      throw new Error(`Tool ${input.toolId} has no default export.`)
    }

    let toolInstance: Tool
    try {
      toolInstance = (await ToolManager.initTool(
        ToolClass as new () => Tool
      )) as Tool
    } catch (error) {
      if (isMissingToolSettingsError(error)) {
        process.stdout.write(
          JSON.stringify({
            success: false,
            message: error.message,
            output: {
              missing_settings: error.missing,
              settings_path: error.settingsPath
            }
          })
        )
        process.exitCode = 1
        return
      }

      throw error
    }
    const method = (toolInstance as unknown as Record<string, unknown>)?.[
      input.functionName
    ]
    if (typeof method !== 'function') {
      throw new Error(
        `Function ${input.functionName} not found on ${input.toolId}.`
      )
    }

    const result = await method.apply(toolInstance, input.args)
    process.stdout.write(
      JSON.stringify({
        success: true,
        message: 'Tool executed successfully.',
        output: { result }
      })
    )
  } catch (error) {
    const message = (error as Error).message || 'Unknown tool runtime error.'
    process.stdout.write(
      JSON.stringify({
        success: false,
        message,
        output: {}
      })
    )
    process.exitCode = 1
  }
}

void run()
