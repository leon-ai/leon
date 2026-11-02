import fs from 'node:fs/promises'
import path from 'node:path'

import assert from 'node:assert/strict'
import type { RealAgentScenario, RealScenarioTurn } from '../e2e/run-agent-provider-scenario'
import type { ToolExecutionInput, ToolExecutionResult } from '@/core/tool-manager/tool-executor'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'

export type ScenarioContext = Parameters<RealAgentScenario['run']>[0]

/**
 * Complete an owner turn through the ordinary asynchronous maintenance lifecycle.
 */
export async function runMaintainedTurn(
  context: ScenarioContext,
  query: string,
  workspace: string,
  existingSessionId?: string
): Promise<RealScenarioTurn> {
  const { POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
  const { runTurnLifecycle } = await import('@/core/turn-lifecycle')
  const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
  const sessionId = existingSessionId ?? CONVERSATION_SESSION_MANAGER.createSession().id
  let turn!: RealScenarioTurn

  await runTurnLifecycle({ sessionId, query }, async () => {
    turn = await context.runTurn(query, sessionId)
    assert.equal(turn.finalIntent, 'answer', turn.output)

    return { output: turn.output, data: {
      finalIntent: turn.finalIntent, executionHistory: turn.executionHistory,
      agentResponseTrace: turn.responseTrace,
      hasExplicitMemoryWrite: turn.hasExplicitMemoryWrite, workspace
    } } as unknown as LLMDutyResult
  })
  await POST_TURN_MAINTENANCE_QUEUE.whenIdle()

  return turn
}

/**
 * Keep task files in a disposable workspace while restoring the caller's cwd.
 */
export async function inScenarioWorkspace(
  profilePath: string,
  execute: (workspace: string) => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const workspace = path.join(profilePath, 'workspace')
  await fs.mkdir(workspace, { recursive: true })
  const previous = process.cwd()
  process.chdir(workspace)

  try {
    return await execute(workspace)
  } finally {
    process.chdir(previous)
  }
}

/**
 * Return controlled external weather observations while leaving local tools real.
 */
export function scenarioWeather(input: ToolExecutionInput): ToolExecutionResult | undefined {
  if (input.toolkitId !== 'weather' || input.toolId !== 'openmeteo' || input.functionName !== 'getWeather') {
    return undefined
  }

  return {
    status: 'success', message: 'Weather retrieved.',
    data: {
      tool_id: input.toolId, toolkit_id: input.toolkitId, function_name: input.functionName,
      input: input.toolInput || null, parsed_input: input.parsedInput || null,
      output: { result: { success: true, data: {
        location: input.parsedInput?.['location'],
        current: { temperature_2m: 18, weather: 'clear' }, units: { temperature_2m: '°C' }
      } } }
    }
  }
}
