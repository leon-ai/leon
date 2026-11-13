import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import type { ModelCall } from '../../model-fault-fixture'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { ProviderRetryReason } from '@/core/llm-manager/types'

const TIME_PATTERN = /\b(\d{2}):(\d{2}):(\d{2})\b/g
const SLOTS = 3
const SECONDS_PER_HOUR = 3_600
const SECONDS_PER_MINUTE = 60

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      await fs.writeFile(path.join(workspace, 'availability.txt'), 'There are no blocked times.\n')
      const first = await context.runTurn('Use this session to propose exactly three meeting slots whenever I give a time window. For each window, read availability.txt with the file tool before proposing slots. Return one time per line in HH:MM:SS format. Do not create events. First window: 09:00 to 09:30.')
      assert.equal(first.finalIntent, 'answer', first.output)

      const { ReActLLMDuty } = await import('@/core/llm-manager/llm-duties/react-llm-duty')
      const { AgentModelResponseTimeoutError } = await import('@/core/llm-manager/llm-duties/react-llm-duty/agent-loop')
      const prototype = ReActLLMDuty.prototype as unknown as { callAgentModel: ModelCall }
      const original = prototype.callAgentModel
      let stalled = false
      let draftInjected = false
      let rejected = false
      let recoveries = 0
      prototype.callAgentModel = async function (...args: Parameters<ModelCall>): ReturnType<ModelCall> {
        const [messages, , , options] = args
        const requestIndex = messages.findLastIndex((message) =>
          message.role === 'user' && !message.runtimeContext
        )
        const hasRead = messages.slice(requestIndex + 1).some((message) =>
          message.role === 'tool' && message.toolName === 'file_system__file__read'
        )
        if (!stalled && hasRead && !options.isCompletionReview) {
          stalled = true
          throw new AgentModelResponseTimeoutError({
            providerEventCount: 3, providerCompleted: false, elapsedMs: 30_000,
            reasoningOnly: false, replaySafe: true, retryReason: ProviderRetryReason.Output
          })
        }
        if (options.isStallRecoveryAttempt) {
          recoveries += 1
        }
        const result = await original.apply(this, args)
        if (options.isCompletionReview) {
          if (result?.textContent) {
            rejected ||= JSON.parse(result.textContent).status === 'continue'
          }
        } else if (stalled && !draftInjected && result?.textContent && !result.toolCalls?.length) {
          draftInjected = true
          return { ...result, textContent: 'I noted the new window: 14:00 to 14:30.' }
        }

        return result
      }

      try {
        const second = await context.runTurn('New window: 14:00 to 14:30.', first.sessionId)
        assert.equal(second.finalIntent, 'answer', second.output)
        assert.ok(stalled && draftInjected && rejected, 'Real completion review must reject acknowledgement-only completion.')
        assert.equal(recoveries, 1)
        const slots = [...second.output.matchAll(TIME_PATTERN)].map((match) =>
          Number(match[1]) * SECONDS_PER_HOUR + Number(match[2]) * SECONDS_PER_MINUTE + Number(match[3])
        )
        assert.equal(slots.length, SLOTS, second.output)
        assert.equal(new Set(slots).size, SLOTS)
        assert.ok(slots.every((time) => time >= 14 * SECONDS_PER_HOUR &&
          time <= 14 * SECONDS_PER_HOUR + 30 * SECONDS_PER_MINUTE), second.output)
        assert.equal(second.executionHistory.filter((execution) => execution.function === 'file_system.file.read').length, 1,
          'Recovery and review must preserve the completed source read.')

        return { first, second, stalled, draftInjected, rejected, recoveries }
      } finally {
        prototype.callAgentModel = original
      }
    })
  }
}

export default scenario
