import { createContextFiles, DEFAULT_CONTEXT_REFRESH_TTL_MS } from '@/core/context-manager/context-file-factory'
import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'

interface WorkerInput {
  filename: string
  workflowLlmName: string
  agentLlmName: string
  localLlmName: string
  runtime: { nodeVersion: string, executable: string, pid: number }
}

function parseArgs(argv: string[]): WorkerInput {
  const input: WorkerInput = {
    filename: '',
    workflowLlmName: 'unknown',
    agentLlmName: 'unknown',
    localLlmName: 'unknown',
    runtime: {
      nodeVersion: process.version, executable: process.execPath, pid: process.pid
    }
  }

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key || value === undefined) {
      continue
    }

    if (key === '--filename') {
      input.filename = value
      index += 1
      continue
    }

    if (key === '--workflow-llm-name') {
      input.workflowLlmName = value
      index += 1
      continue
    }

    if (key === '--agent-llm-name') {
      input.agentLlmName = value
      index += 1
      continue
    }

    if (key === '--local-llm-name') {
      input.localLlmName = value
      index += 1
      continue
    }

    if (key === '--runtime-node-version') {
      input.runtime.nodeVersion = value
      index += 1
      continue
    }

    if (key === '--runtime-executable') {
      input.runtime.executable = value
      index += 1
      continue
    }

    if (key === '--runtime-pid') {
      input.runtime.pid = Number(value)
      index += 1
    }
  }

  return input
}

async function main(): Promise<void> {
  const input = parseArgs(process.argv.slice(2))
  if (!input.filename) {
    throw new Error('Missing --filename')
  }

  const probeHelper = new ContextProbeHelper()
  const contextFiles = createContextFiles(
    probeHelper,
    DEFAULT_CONTEXT_REFRESH_TTL_MS,
    {
      getWorkflowLLMName: () => input.workflowLlmName,
      getAgentLLMName: () => input.agentLlmName,
      getLocalLLMName: () => input.localLlmName,
      runtime: input.runtime
    }
  )
  const definition = contextFiles.find(
    (contextFile) => contextFile.filename === input.filename
  )

  if (!definition) {
    throw new Error(`Unknown context file: ${input.filename}`)
  }

  const content = definition.generate()
  process.stdout.write(
    JSON.stringify({
      success: true,
      content
    })
  )
}

try {
  await main()
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      success: false,
      error: String(error)
    })
  )
  process.exitCode = 1
}
