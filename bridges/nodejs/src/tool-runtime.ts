/**
 * Tool runtime for executing Node.js tools.
 * This runtime exists only for Node.js because the core server is built on Node.js
 * and the ReAct loop only needs a single bridge for now.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveToolDirectory } from '@/leon-roots'

import type { ToolExecutionContext, ToolRuntimeResult } from '@sdk/tool-runtime-types'
import { ToolRuntimeLifetime, type ManagedTool, type ToolWorkerRequest } from './tool-runtime-types'
import { runWithConversationSession } from '@/core/session-manager/session-context'
import {
  PROFILE_TOOLS_PATH,
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

  if (!toolkitId || !toolId || (!functionName && !process.send)) {
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
  for (const toolsPath of [PROFILE_TOOLS_PATH, TOOLS_PATH]) {
    const toolModulePath = path.join(
      resolveToolDirectory(toolsPath, toolkitId, toolId),
      'src',
      'nodejs',
      'index.ts'
    )
    if (fs.existsSync(toolModulePath)) {
      return toolModulePath
    }
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

let toolInstance: ManagedTool | undefined
let closing = false
let activeCall: AbortController | undefined
let execution: Promise<void> = Promise.resolve()

/**
 * Wait for delivered native input to settle before releasing its resources.
 */
const shutdown = async (): Promise<void> => {
  if (closing) return
  closing = true
  activeCall?.abort(new Error('Tool execution canceled during worker shutdown.'))
  await execution
  try {
    await toolInstance?.dispose?.()
  } finally {
    process.exit(0)
  }
}

const execute = async (context: ToolExecutionContext, args: unknown[]): Promise<ToolRuntimeResult> => {
  try {
    if (!toolInstance) {
      const toolModulePath = resolveToolModulePath(context.toolkitId, context.toolId)
      if (!toolModulePath) throw new Error(`Tool module not found for ${context.toolId}.`)
      const { default: ToolManager } = await import('@sdk/tool-manager')
      const { default: ToolClass } = await import(pathToFileURL(toolModulePath).href)
      toolInstance = await ToolManager.initTool(ToolClass)
    }
    await toolInstance.prepareExecution(context)
    const method = (toolInstance as unknown as Record<string, unknown>)[context.functionName]
    if (typeof method !== 'function') throw new Error(`Function ${context.functionName} not found on ${context.toolId}.`)
    const result = await method.apply(toolInstance, args)
    return {
      success: true, message: 'Tool executed successfully.', output: { result },
      ...(toolInstance.getModelFiles().length ? { modelFiles: toolInstance.getModelFiles() } : {})
    }
  } catch (error) {
    const { isMissingToolSettingsError } = await import('@sdk/tool-manager')
    return {
      success: false, message: (error as Error).message || 'Unknown tool runtime error.',
      output: isMissingToolSettingsError(error)
        ? { missing_settings: error.missing, settings_path: error.settingsPath } : {}
    }
  }
}

const run = async (): Promise<void> => {
  setProjectCwd()
  setRuntimeToolReporter()
  const input = parseArgs()
  if (process.send) {
    process.on('message', (request: ToolWorkerRequest) => {
      if (request.type === 'shutdown') { void shutdown(); return }
      if (closing || request.type !== 'execute') return
      execution = execution.then(async () => {
        // The process is profile-bound; only conversation context changes per call.
        if (request.context.profileName !== process.env['LEON_PROFILE'] ||
            request.context.toolkitId !== input.toolkitId || request.context.toolId !== input.toolId) {
          throw new Error('Tool worker context does not match its owner.')
        }
        process.env['LEON_SESSION_ID'] = request.context.conversationSessionId || ''
        activeCall = new AbortController()
        const result = await runWithConversationSession(
          { sessionId: request.context.conversationSessionId || '' },
          () => execute({ ...request.context, signal: activeCall!.signal }, request.args)
        )
        activeCall = undefined
        const lifetime = toolInstance?.runtimeLifetime ?? ToolRuntimeLifetime.Call
        await new Promise<void>((resolve, reject) => {
          process.send?.({ type: 'result', lifetime, result }, (error: Error | null) => error ? reject(error) : resolve())
        })
        if (lifetime === ToolRuntimeLifetime.Call) {
          await toolInstance?.dispose?.()
          toolInstance = undefined
          process.disconnect?.()
        }
      }).catch((error: unknown) => {
        process.stderr.write(`[LEON_TOOL_LOG] ${String(error)}\n`)
        void shutdown()
      })
    })
    process.once('disconnect', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
    process.once('SIGINT', () => void shutdown())
    return
  }
  const result = await execute({ ...input, parameters: {},
    profileName: process.env['LEON_PROFILE'] || '',
    conversationSessionId: process.env['LEON_SESSION_ID'] || null }, input.args)
  process.stdout.write(JSON.stringify(result))
  await toolInstance?.dispose?.()
  if (!result.success) process.exitCode = 1
}

void run()
