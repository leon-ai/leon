import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../e2e/run-agent-provider-scenario'
import type { AgentToolTranscriptMessage, OpenAITool, OpenAIToolCall } from '@/core/llm-manager/types'
import { inScenarioWorkspace } from './scenario-fixture'

export enum ModelFault {
  IncorrectDraft = 'incorrect-draft',
  ContextFailure = 'context-failure'
}

interface ModelReply {
  textContent?: string
  toolCalls?: OpenAIToolCall[]
  isTruncated?: boolean
}

type ModelCall = (
  this: unknown,
  messages: AgentToolTranscriptMessage[],
  prompt: string,
  tools: OpenAITool[],
  options: { isCompletionReview?: boolean, isRecoveryAttempt: boolean },
  ...rest: unknown[]
) => Promise<ModelReply | null>

const MARKER = 'verified-inspection-42'

/**
 * Inject one controlled model failure while retaining real operational inference
 * and real completion review, so recovery cannot pass through a mocked verifier.
 */
export function createModelFaultScenario(fault: ModelFault): RealAgentScenario {
  return {
    async run(context): Promise<Record<string, unknown>> {
      return inScenarioWorkspace(context.profilePath, async (workspace) => {
        const { ReActLLMDuty } = await import('@/core/llm-manager/llm-duties/react-llm-duty')
        const { AgentModelProviderError } = await import('@/core/llm-manager/llm-duties/react-llm-duty/agent-loop')
        const prototype = ReActLLMDuty.prototype as unknown as { callAgentModel: ModelCall }
        const original = prototype.callAgentModel
        let injected = false
        let reviews = 0
        let rejections = 0
        prototype.callAgentModel = async function (...args: Parameters<ModelCall>): Promise<ModelReply | null> {
          const [messages, , , options] = args
          const hasWritten = messages.some((message) => message.role === 'tool' && message.toolName.endsWith('__write'))
          if (!injected && hasWritten && !options.isCompletionReview && fault === ModelFault.ContextFailure) {
            injected = true
            throw new AgentModelProviderError('The controlled provider rejected the context size.', true)
          }

          const result = await original.apply(this, args)
          if (options.isCompletionReview) {
            reviews += 1
            let review: { status?: string } | undefined
            try {
              review = result?.textContent ? JSON.parse(result.textContent) : undefined
            } catch {
              // Invalid reviews belong to the real review parser and its retry policy.
            }
            if (review?.status === 'continue') {
              rejections += 1
            }
          } else if (!injected && hasWritten && result?.textContent && !result.toolCalls?.length &&
            fault === ModelFault.IncorrectDraft) {
            injected = true
            return { ...result, textContent: 'The file contains failed-inspection-99.' }
          }

          return result
        }

        try {
          const turn = await context.runTurn(`Use the file tool to create evidence.txt containing exactly ${MARKER}. Read it back to verify it. Your final answer must quote its exact contents.`)
          assert.ok(injected, 'The failure must occur after a real write, before successful completion.')
          assert.equal(turn.finalIntent, 'answer', turn.output)
          assert.equal((await fs.readFile(path.join(workspace, 'evidence.txt'), 'utf8')).trim(), MARKER)
          assert.ok(turn.output.includes(MARKER))
          assert.equal(turn.executionHistory.filter((execution) => execution.function === 'file_system.file.write').length, 1,
            'Recovery must preserve the completed write rather than replay its side effect.')
          assert.ok(reviews > 0)
          if (fault === ModelFault.IncorrectDraft) {
            assert.ok(rejections > 0, 'Real review must reject the unsupported draft.')
          }

          return { turn, injected, reviews, rejections }
        } finally {
          prototype.callAgentModel = original
        }
      })
    }
  }
}
