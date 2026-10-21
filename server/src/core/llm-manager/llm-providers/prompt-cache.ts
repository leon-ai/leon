import { createHash } from 'node:crypto'

import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'
import type { PromptCacheObservation } from '@/core/llm-manager/types'

const MAXIMUM_TRACKED_SCOPES = 32
const CACHE_KEY_HASH_LENGTH = 48

interface RequestSnapshot {
  systemHash: string
  toolsHash: string
  optionsHash: string
  items: string[]
  tools: Map<string, string>
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value) ?? '').digest('hex')
}

/**
 * Scopes provider hints and compares final payloads without retaining owner data.
 */
export class ProviderPromptCache {
  private readonly snapshots = new Map<string, RequestSnapshot>()

  /**
   * Keeps one conversation's cache identity stable across retries and compaction.
   */
  public prepare(
    body: Record<string, unknown>,
    binding: string,
    observeOnly = false,
    scope = 'agent'
  ): { sessionId: string | null, observation?: PromptCacheObservation } {
    const sessionId = getActiveConversationSessionId()
    const hint = body['prompt_cache_key']

    if (!observeOnly && (typeof hint !== 'string' || !hint)) {
      return { sessionId }
    }

    const key = `leon-${fingerprint([
      getActiveProfileName(), binding, sessionId, body['model'],
      typeof hint === 'string' ? hint : scope
    ]).slice(0, CACHE_KEY_HASH_LENGTH)}`
    if (!observeOnly) {
      body['prompt_cache_key'] = key
    }

    const input = Array.isArray(body['input'])
      ? body['input'] as Record<string, unknown>[]
      : typeof body['input'] === 'string'
        ? [{ role: 'user', content: body['input'] }]
        : Array.isArray(body['messages'])
          ? body['messages'] as Record<string, unknown>[]
          : []
    // Late instruction updates are history additions, not a rewritten head.
    const firstHistoryIndex = input.findIndex((item) =>
      item?.['role'] !== 'system' && item?.['role'] !== 'developer'
    )
    const head = input.slice(0, firstHistoryIndex < 0 ? input.length : firstHistoryIndex)
    const tools = new Map<string, string>()

    for (const tool of (Array.isArray(body['tools']) ? body['tools'] : [])) {
      const name = tool?.function?.name ?? tool?.name ?? tool?.type
      tools.set(String(name), fingerprint(tool))
    }

    const snapshot: RequestSnapshot = {
      systemHash: fingerprint([
        body['instructions'], body['system'], head
      ]),
      toolsHash: fingerprint(body['tools']),
      optionsHash: fingerprint([
        body['reasoning'], body['thinking'], body['tool_choice'], body['text'],
        body['context_management'], body['service_tier'], body['response_format']
      ]),
      items: input.map(fingerprint),
      tools
    }
    const previous = this.snapshots.get(key)
    let matchingPrefixItems = 0

    while (previous && matchingPrefixItems < previous.items.length &&
      previous.items[matchingPrefixItems] === snapshot.items[matchingPrefixItems]) {
      matchingPrefixItems += 1
    }

    const changedInputs: string[] = []

    if (previous) {
      if (previous.systemHash !== snapshot.systemHash) {
        changedInputs.push('system')
      }
      if (previous.toolsHash !== snapshot.toolsHash) {
        changedInputs.push('tools')
      }
      if (previous.optionsHash !== snapshot.optionsHash) {
        changedInputs.push('options')
      }
      if (matchingPrefixItems < previous.items.length) {
        changedInputs.push('history')
      }
    }

    // An unbound helper request must not become another conversation's baseline.
    if (sessionId) {
      this.snapshots.delete(key)
      this.snapshots.set(key, snapshot)

      if (this.snapshots.size > MAXIMUM_TRACKED_SCOPES) {
        this.snapshots.delete(this.snapshots.keys().next().value!)
      }
    }

    return {
      sessionId,
      observation: {
        key,
        systemHash: snapshot.systemHash,
        toolsHash: snapshot.toolsHash,
        inputItems: snapshot.items.length,
        previousInputItems: previous?.items.length ?? 0,
        matchingPrefixItems,
        changedInputs,
        ...(previous ? { toolChanges: {
          added: [...tools.keys()].filter((name) => !previous.tools.has(name)).length,
          removed: [...previous.tools.keys()].filter((name) => !tools.has(name)).length,
          modified: [...tools].filter(([name, hash]) =>
            previous.tools.has(name) && previous.tools.get(name) !== hash
          ).length,
          reordered: fingerprint([...tools.keys()].filter((name) => previous.tools.has(name))) !==
            fingerprint([...previous.tools.keys()].filter((name) => tools.has(name)))
        } } : {})
      }
    }
  }
}
