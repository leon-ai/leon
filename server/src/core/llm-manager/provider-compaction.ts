import type {
  AgentToolTranscriptMessage,
  ProviderCompactionContext
} from '@/core/llm-manager/types'

/**
 * Restores source evidence when an opaque window cannot be replayed by a target.
 * Sources are flattened before saving another window to avoid nested snapshots.
 */
export function restoreCompactionSources(
  transcript: AgentToolTranscriptMessage[],
  binding?: string | null
): AgentToolTranscriptMessage[] {
  return transcript.flatMap((message) => {
    const context = message.role === 'assistant'
      ? message.compactionContext
      : undefined

    if (context && context.binding !== binding) {
      const source = restoreCompactionSources(context.sourceTranscript, binding)

      if (binding !== undefined) {
        // Source tool evidence is portable; signed/encrypted reasoning is not.
        return source.map((item) => {
          if (item.role === 'assistant' && item.reasoningItems?.length) {
            return { ...item, reasoningItems: [] }
          }

          return item
        })
      }

      return source
    }

    return [message]
  })
}

/**
 * Expands an SDK compaction marker into the ordered provider output window.
 * Compaction and following reasoning/tool items retain their exact order and fields.
 */
export function replayCompactionWindows(
  input: Record<string, unknown>[],
  contexts: ProviderCompactionContext[]
): Record<string, unknown>[] {
  return input.flatMap((item) => {
    const context = contexts.find((candidate) => candidate.output.some(
      (output) => output['type'] === 'compaction' &&
        output['id'] === item['id']
    ))

    return item['type'] === 'compaction' && context
      ? context.output
      : [item]
  })
}
