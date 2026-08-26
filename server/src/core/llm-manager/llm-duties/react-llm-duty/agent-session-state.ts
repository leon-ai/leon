import { ContextStateStore } from '@/core/context-manager/context-state-store'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'
import type { MessageLog } from '@/types'

import type { AgentLoopContinuationState } from './agent-loop-continuation'

const AGENT_CONTINUATION_STATE_FILENAME = '.agent-loop-continuation-state.json'
// Preserve existing rolling summaries across the loop migration.
const AGENT_HISTORY_COMPACTION_STATE_FILENAME =
  '.react-history-compaction-state.json'
const AGENT_SESSION_STATE_FILENAME_SEPARATOR = '--'

export type AgentHistoryCompactionScope = 'local' | 'remote'

export interface AgentHistoryCompactionProviderState {
  summary: string | null
  summarySentAt: number | null
  tail: MessageLog[]
  newMessagesSinceCompaction: number
}

export interface AgentHistoryCompactionState {
  version: 1
  local: AgentHistoryCompactionProviderState
  remote: AgentHistoryCompactionProviderState
}

export interface AgentHistoryCompactionConfig {
  historyLimit: number
  compactionBatchSize: number
}

export function createEmptyHistoryCompactionProviderState(): AgentHistoryCompactionProviderState {
  return {
    summary: null,
    summarySentAt: null,
    tail: [],
    newMessagesSinceCompaction: 0
  }
}

const AGENT_HISTORY_COMPACTION_STATE_FALLBACK: AgentHistoryCompactionState = {
  version: 1,
  local: createEmptyHistoryCompactionProviderState(),
  remote: createEmptyHistoryCompactionProviderState()
}

/** Owns the profile- and session-scoped state stores used by the agent loop. */
export class AgentSessionState {
  private readonly continuationStores =
    new Map<string, ContextStateStore<AgentLoopContinuationState | null>>()
  private readonly historyCompactionStores =
    new Map<string, ContextStateStore<AgentHistoryCompactionState>>()

  public getContinuationStore(): ContextStateStore<AgentLoopContinuationState | null> {
    const filename = this.getSessionFilename(AGENT_CONTINUATION_STATE_FILENAME)
    const storeKey = `${getActiveProfileName()}:${filename}`
    const existingStore = this.continuationStores.get(storeKey)

    if (existingStore) return existingStore

    const store = new ContextStateStore<AgentLoopContinuationState | null>(
      filename,
      null
    )
    this.continuationStores.set(storeKey, store)

    return store
  }

  public getHistoryCompactionStore(): ContextStateStore<AgentHistoryCompactionState> {
    const filename = this.getSessionFilename(
      AGENT_HISTORY_COMPACTION_STATE_FILENAME
    )
    const storeKey = `${getActiveProfileName()}:${filename}`
    const existingStore = this.historyCompactionStores.get(storeKey)

    if (existingStore) return existingStore

    const store = new ContextStateStore<AgentHistoryCompactionState>(
      filename,
      AGENT_HISTORY_COMPACTION_STATE_FALLBACK
    )
    this.historyCompactionStores.set(storeKey, store)

    return store
  }

  private getSessionFilename(filename: string): string {
    const sessionId = getActiveConversationSessionId()
    return sessionId
      ? `${filename}${AGENT_SESSION_STATE_FILENAME_SEPARATOR}${sessionId}`
      : filename
  }
}
