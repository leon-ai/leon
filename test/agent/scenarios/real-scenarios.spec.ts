import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { execa } from 'execa'
import { expect, it } from 'vitest'

import { CONFIG_MANAGER } from '@/config'
import { DEFAULT_INSTALLED_LLM_PATH, LLM_DIR_PATH } from '@/constants'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { resolveConfiguredLLMTarget } from '@/core/llm-manager/llm-routing'
import type { ConversationSession } from '@/core/session-manager'
import { RuntimeHelper } from '@/helpers/runtime-helper'

const SELECTION = process.env['LEON_AGENT_REAL_SCENARIO']
const SCENARIO_SUFFIX = '.scenario.ts'
const SCENARIOS = (await fs.readdir(new URL('./', import.meta.url)))
  .filter((name) => name.endsWith(SCENARIO_SUFFIX))
  .map((name) => name.slice(0, -SCENARIO_SUFFIX.length))
  .filter((name) => !SELECTION || SELECTION === '*' || SELECTION === name)
  .sort()
const RESULT_PREFIX = '__AGENT_RESULT__'
const PROGRESS_PREFIX = '__AGENT_PROGRESS__'
const TIMEOUT_MS = 300_000

/**
 * Stop probe descendants in this test's process group before deleting its home.
 */
function stopScenarioProcesses(pid: number | undefined): void {
  if (process.platform === 'win32' || !pid) {
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error
    }
  }
}

// Only the scenario command opts in; broad Vitest runs never make paid calls.
it.skipIf(!SELECTION).each(SCENARIOS)('%s', async (scenario) => {
  const profile = getProfilePaths()
  const indexPath = path.join(profile.sessions, 'index.json')
  const index = await fs.readFile(indexPath, 'utf8').then(
    (content) => JSON.parse(content) as {
      activeSessionId: string
      sessions: ConversationSession[]
    },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error
      }
      return null
    }
  )
  const config = CONFIG_MANAGER.getConfig().llm
  const activeSession = index?.sessions.find(
    (session) => session.id === index.activeSessionId
  )
  const targetValue = activeSession?.modelTarget ||
    (config.agent ?? config.default ?? '')
  const target = resolveConfiguredLLMTarget(targetValue, {
    defaultInstalledLLMPath: DEFAULT_INSTALLED_LLM_PATH,
    llmDirPath: LLM_DIR_PATH
  })
  expect(
    target.isEnabled && target.isResolved,
    target.resolutionError || 'No active agent model.'
  ).toBe(true)
  const startedAt = Date.now()

  console.info(`[scenario:${scenario}] START profile=${profile.name} model=${target.label}`)
  const testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-agent-e2e-'))
  const directory = path.join('tmp', 'agent-scenarios')
  await fs.mkdir(directory, { recursive: true })
  const evidencePath = path.join(directory, `${scenario}-${Date.now()}.log`)
  const child = execa(process.execPath, [
    '--import', 'tsx',
    'test/agent/e2e/run-agent-provider-scenario.ts',
    target.provider!, scenario,
    '--real-scenario', '--runtime', 'tool'
  ], {
    env: {
      ...process.env,
      LEON_NODE_ENV: 'testing',
      LEON_AGENT_SCENARIO_HOME: testHome,
      LEON_AGENT_E2E_SOURCE_CONFIG_PATH: profile.config,
      LEON_AGENT_SCENARIO_TARGET: target.isLocal
        ? `${target.provider}/${target.model}` : targetValue,
      LEON_AGENT_E2E_SOURCE_JQ_PATH: RuntimeHelper.getJQBinPath()
    },
    all: true,
    reject: false,
    detached: process.platform !== 'win32',
    timeout: TIMEOUT_MS
  })
  let pending = ''
  let captured = ''
  child.all?.setEncoding('utf8')
  child.all?.on('data', (chunk: string) => {
    captured += chunk
    pending += chunk
    const lines = pending.split('\n')
    pending = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith(PROGRESS_PREFIX)) {
        const event = JSON.parse(line.slice(PROGRESS_PREFIX.length)) as {
          stage: string
          turn?: number
          message: string
          data?: { input?: string, output?: string }
        }
        const detail = event.data?.input || event.data?.output || event.message
        console.info(`[scenario:${scenario}] ${event.stage}${event.turn ? ` ${event.turn}` : ''}: ${detail}`)
      }
    }
  })

  try {
    const { all = '', exitCode } = await child
    const line = all.split('\n').findLast((entry) => entry.startsWith(RESULT_PREFIX))
    expect(line, `Missing result; see ${evidencePath}`).toBeDefined()
    const result = JSON.parse(line!.slice(RESULT_PREFIX.length))
    expect(
      exitCode,
      `${result.reason || 'Scenario failed'}; see ${evidencePath}`
    ).toBe(0)
    expect(result.skipped, result.reason).toBe(false)
    expect(result.scenarioId).toBe(scenario)
    expect(result.evidence).toBeDefined()
    console.info(`[scenario:${scenario}] PASS (${Date.now() - startedAt} ms)`)
  } catch (error) {
    console.error(`[scenario:${scenario}] FAIL (${Date.now() - startedAt} ms)`)
    throw error
  } finally {
    await fs.writeFile(evidencePath, captured, { mode: 0o600 })
    console.info(`[scenario:${scenario}] Evidence: ${evidencePath}`)
    // The child may exit while context-probe descendants are still writing.
    // Stop only this test's process group before removing its private home.
    stopScenarioProcesses(child.pid)
    await fs.rm(testHome, { recursive: true, force: true })
    expect(await fs.stat(testHome).then(() => true, () => false)).toBe(false)
  }
}, TIMEOUT_MS + 30_000)
