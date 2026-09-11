import { describe, expect, it } from 'vitest'

import {
  extractFinalAnswerFromToolResult,
  extractOwnerActionHandoffFromToolResult
} from '@/core/llm-manager/llm-duties/react-llm-duty/utils'

describe('ReAct LLM duty utilities', () => {
  it('extracts a terminal answer wrapped by the Node tool runtime', () => {
    expect(extractFinalAnswerFromToolResult({
      status: 'success',
      data: {
        output: {
          result: {
            final_answer: 'Background result.'
          }
        }
      }
    })).toBe('Background result.')
  })

  it('extracts a terminal owner-action handoff from a wrapped tool result', () => {
    expect(extractOwnerActionHandoffFromToolResult({
      data: {
        output: {
          result: {
            success: false,
            status: 'owner_action_required',
            owner_action: {
              message: 'Enable browser access, then tell me to retry.'
            }
          }
        }
      }
    })).toEqual({
      intent: 'clarification',
      draft: 'Enable browser access, then tell me to retry.'
    })
  })

  it('does not elevate advisory guidance without an owner action', () => {
    expect(extractOwnerActionHandoffFromToolResult({
      data: {
        output: {
          result: {
            status: 'owner_action_required',
            guidance: 'Try another tool.'
          }
        }
      }
    })).toBeNull()
  })
})
