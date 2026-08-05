import { describe, expect, it } from 'vitest'

import { extractFinalAnswerFromToolResult } from '@/core/llm-manager/llm-duties/react-llm-duty/utils'

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
})
