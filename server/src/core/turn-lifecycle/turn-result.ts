import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'

/**
 * Reads tool execution evidence independently of the transport that ran a turn.
 */
export function normalizeOwnerProfileToolExecutions(
  result: LLMDutyResult | null
): Array<{
  functionName: string
  status: 'success' | 'error'
  observation: string
}> {
  const executionHistory = Array.isArray(result?.data?.['executionHistory'])
    ? result.data['executionHistory']
    : []

  return executionHistory
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const record = item as Record<string, unknown>
      const functionName = typeof record['function'] === 'string' ? record['function'].trim() : ''
      if (!functionName) {
        return null
      }

      return {
        functionName,
        status:
          record['status'] === 'error'
            ? ('error' as const)
            : ('success' as const),
        observation: typeof record['observation'] === 'string' ? record['observation'].trim() : ''
      }
    })
    .filter(
      (item): item is {
        functionName: string
        status: 'success' | 'error'
        observation: string
      } => item !== null
    )
}
