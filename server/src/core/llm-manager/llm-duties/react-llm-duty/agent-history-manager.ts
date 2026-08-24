import { CONVERSATION_LOGGER, LLM_PROVIDER } from '@/core'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { isLocalLLMProvider } from '@/core/llm-manager/model-context-windows'
import { LLMDuties, type LLMProviders } from '@/core/llm-manager/types'
import type { PostTurnMaintenanceTask } from '@/core/post-turn-maintenance-queue'
import { ConversationHistoryHelper } from '@/helpers/conversation-history-helper'
import { LogHelper } from '@/helpers/log-helper'
import type { MessageLog } from '@/types'

import {
  AGENT_HISTORY_COMPACTION_MAX_TOKENS,
  AGENT_HISTORY_COMPACTION_RETRY_MAX_TOKENS,
  AGENT_HISTORY_COMPACTION_SYSTEM_PROMPT,
  AGENT_LOCAL_PROVIDER_HISTORY_COMPACTION_POINT,
  AGENT_LOCAL_PROVIDER_HISTORY_LOGS,
  AGENT_REMOTE_PROVIDER_HISTORY_COMPACTION_POINT,
  AGENT_REMOTE_PROVIDER_HISTORY_LOGS
} from './constants'
import {
  buildCompactedHistoryMessage,
  findMessageSequenceStart,
  formatHistoryForCompaction,
  hasHistoryCompactionContent,
  normalizeHistoryCompactionSummary
} from './history-compaction'
import { emitPlanWidget } from './plan-widget'
import {
  AgentSessionState,
  createEmptyHistoryCompactionProviderState,
  type AgentHistoryCompactionConfig,
  type AgentHistoryCompactionProviderState,
  type AgentHistoryCompactionScope,
  type AgentHistoryCompactionState
} from './agent-session-state'
import type { PlanStepStatus, TrackedPlanStep } from './types'

interface PreparedAgentHistory {
  messageLogs: MessageLog[]
}

function getLLMProviderName(): LLMProviders {
  const provider = CONFIG_STATE.getModelState().getAgentProvider()
  if (!provider) throw new Error('The agent LLM provider is disabled.')
  return provider
}

/** Owns rolling conversation history, compaction state, and maintenance work. */
export class AgentHistoryManager {
  public constructor(
    private readonly name: string,
    private readonly sessionState: AgentSessionState
  ) {}

  public async loadPreparedHistory(): Promise<PreparedAgentHistory> {
    const historyConfig = this.getHistoryCompactionConfig()
    const historyScope = this.getHistoryCompactionScope()
    const conversationLogs = this.getHistoryEligibleConversationLogs(
      await CONVERSATION_LOGGER.loadAll()
    )
    const currentState = this.loadHistoryCompactionProviderState(historyScope)
    const synchronizedState = this.synchronizeHistoryCompactionState(
      conversationLogs,
      currentState
    )

    if (synchronizedState.shouldPersist) {
      this.saveHistoryCompactionProviderState(historyScope, synchronizedState.state)
    }

    return this.buildPreparedHistory(
      this.buildHistoryForCurrentTurn(
        conversationLogs,
        synchronizedState.state,
        historyConfig
      )
    )
  }

  private getHistoryCompactionScope(): AgentHistoryCompactionScope {
    return isLocalLLMProvider(getLLMProviderName())
      ? 'local'
      : 'remote'
  }

  private getHistoryCompactionConfig(): AgentHistoryCompactionConfig {
    if (isLocalLLMProvider(getLLMProviderName())) {
      return {
        historyLimit: AGENT_LOCAL_PROVIDER_HISTORY_LOGS,
        compactionBatchSize: AGENT_LOCAL_PROVIDER_HISTORY_COMPACTION_POINT
      }
    }

    return {
      historyLimit: AGENT_REMOTE_PROVIDER_HISTORY_LOGS,
      compactionBatchSize: AGENT_REMOTE_PROVIDER_HISTORY_COMPACTION_POINT
    }
  }

  private getHistoryEligibleConversationLogs(
    conversationLogs: MessageLog[]
  ): MessageLog[] {
    return conversationLogs.filter(
      (conversationLog) => ConversationHistoryHelper.isAddedToHistory(conversationLog)
    )
  }

  private loadHistoryCompactionProviderState(
    scope: AgentHistoryCompactionScope
  ): AgentHistoryCompactionProviderState {
    const persistedState =
      this.sessionState.getHistoryCompactionStore().load()
    return this.normalizeHistoryCompactionProviderState(persistedState?.[scope])
  }

  private normalizeHistoryCompactionProviderState(
    value: unknown
  ): AgentHistoryCompactionProviderState {
    const record =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null

    return {
      summary: normalizeHistoryCompactionSummary(record?.['summary']),
      summarySentAt:
        typeof record?.['summarySentAt'] === 'number'
          ? record['summarySentAt']
          : null,
      newMessagesSinceCompaction:
        typeof record?.['newMessagesSinceCompaction'] === 'number' &&
        Number.isFinite(record['newMessagesSinceCompaction']) &&
        record['newMessagesSinceCompaction'] >= 0
          ? Math.floor(record['newMessagesSinceCompaction'])
          : 0,
      tail: this.normalizeMessageLogs(record?.['tail'])
    }
  }

  private saveHistoryCompactionProviderState(
    scope: AgentHistoryCompactionScope,
    providerState: AgentHistoryCompactionProviderState
  ): void {
    const stateStore = this.sessionState.getHistoryCompactionStore()
    const persistedState = stateStore.load()
    const nextState: AgentHistoryCompactionState = {
      version: 1,
      local:
        scope === 'local'
          ? providerState
          : this.normalizeHistoryCompactionProviderState(persistedState?.local),
      remote:
        scope === 'remote'
          ? providerState
          : this.normalizeHistoryCompactionProviderState(persistedState?.remote)
    }

    stateStore.save(nextState)
  }

  private normalizeMessageLogs(value: unknown): MessageLog[] {
    if (!Array.isArray(value)) {
      return []
    }

    return value.flatMap((item) => {
      const record =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null

      if (
        !record ||
        (record['who'] !== 'owner' && record['who'] !== 'leon') ||
        typeof record['sentAt'] !== 'number' ||
        typeof record['message'] !== 'string'
      ) {
        return []
      }

      return [
        {
          who: record['who'],
          sentAt: record['sentAt'],
          message: record['message'],
          isAddedToHistory:
            typeof record['isAddedToHistory'] === 'boolean'
              ? record['isAddedToHistory']
              : true
        }
      ]
    })
  }

  private hasStoredHistoryCompactionState(
    state: AgentHistoryCompactionProviderState
  ): boolean {
    return Boolean(
      hasHistoryCompactionContent(state.summary) ||
        state.summarySentAt !== null ||
        state.tail.length > 0 ||
        state.newMessagesSinceCompaction > 0
    )
  }

  private areMessageLogsEqual(left: MessageLog[], right: MessageLog[]): boolean {
    if (left.length !== right.length) {
      return false
    }

    return left.every((message, index) => {
      const otherMessage = right[index]

      return (
        otherMessage &&
        message.who === otherMessage.who &&
        message.sentAt === otherMessage.sentAt &&
        message.message === otherMessage.message
      )
    })
  }

  private areHistoryCompactionStatesEqual(
    left: AgentHistoryCompactionProviderState,
    right: AgentHistoryCompactionProviderState
  ): boolean {
    return (
      left.summary === right.summary &&
      left.summarySentAt === right.summarySentAt &&
      left.newMessagesSinceCompaction === right.newMessagesSinceCompaction &&
      this.areMessageLogsEqual(left.tail, right.tail)
    )
  }

  private rebuildHistoryCompactionStateFromBoundary(
    conversationLogs: MessageLog[],
    currentState: AgentHistoryCompactionProviderState
  ): AgentHistoryCompactionProviderState {
    if (
      !hasHistoryCompactionContent(currentState.summary) ||
      currentState.summarySentAt === null
    ) {
      return createEmptyHistoryCompactionProviderState()
    }

    const rebuiltTail = conversationLogs.filter(
      (conversationLog) => conversationLog.sentAt > currentState.summarySentAt!
    )

    return {
      summary: currentState.summary,
      summarySentAt: currentState.summarySentAt,
      tail: rebuiltTail,
      newMessagesSinceCompaction: rebuiltTail.length
    }
  }

  private synchronizeHistoryCompactionState(
    conversationLogs: MessageLog[],
    currentState: AgentHistoryCompactionProviderState
  ): {
    state: AgentHistoryCompactionProviderState
    shouldPersist: boolean
  } {
    const emptyState = createEmptyHistoryCompactionProviderState()

    if (!hasHistoryCompactionContent(currentState.summary)) {
      return {
        state: emptyState,
        shouldPersist:
          this.hasStoredHistoryCompactionState(currentState) &&
          !this.areHistoryCompactionStatesEqual(currentState, emptyState)
      }
    }

    if (currentState.tail.length === 0) {
      const rebuiltState = this.rebuildHistoryCompactionStateFromBoundary(
        conversationLogs,
        currentState
      )

      return {
        state: rebuiltState,
        shouldPersist: !this.areHistoryCompactionStatesEqual(
          currentState,
          rebuiltState
        )
      }
    }

    const tailStartIndex = findMessageSequenceStart(conversationLogs, currentState.tail)
    if (tailStartIndex === -1) {
      const rebuiltState = this.rebuildHistoryCompactionStateFromBoundary(
        conversationLogs,
        currentState
      )

      LogHelper.title(this.name)
      LogHelper.debug(
        'History compaction tail mismatch; rebuilding from compaction boundary'
      )

      return {
        state: rebuiltState,
        shouldPersist: !this.areHistoryCompactionStatesEqual(
          currentState,
          rebuiltState
        )
      }
    }

    const synchronizedState: AgentHistoryCompactionProviderState = {
      summary: currentState.summary,
      summarySentAt: currentState.summarySentAt,
      tail: conversationLogs.slice(tailStartIndex),
      newMessagesSinceCompaction:
        currentState.newMessagesSinceCompaction +
        (conversationLogs.length - tailStartIndex - currentState.tail.length)
    }

    return {
      state: synchronizedState,
      shouldPersist: !this.areHistoryCompactionStatesEqual(
        currentState,
        synchronizedState
      )
    }
  }

  private buildHistoryForCurrentTurn(
    conversationLogs: MessageLog[],
    state: AgentHistoryCompactionProviderState,
    config: AgentHistoryCompactionConfig
  ): MessageLog[] {
    if (hasHistoryCompactionContent(state.summary)) {
      return this.buildHistoryFromCompactionState({
        ...state,
        tail: state.tail.slice(-(config.historyLimit - 1))
      })
    }

    return conversationLogs.slice(-config.historyLimit)
  }

  private getStateForPostAnswerCompaction(
    conversationLogs: MessageLog[],
    synchronizedState: AgentHistoryCompactionProviderState
  ): AgentHistoryCompactionProviderState {
    if (hasHistoryCompactionContent(synchronizedState.summary)) {
      return synchronizedState
    }

    return {
      summary: null,
      summarySentAt: null,
      tail: [...conversationLogs],
      newMessagesSinceCompaction: conversationLogs.length
    }
  }

  private async rollHistoryCompactionState(
    state: AgentHistoryCompactionProviderState,
    config: AgentHistoryCompactionConfig
  ): Promise<AgentHistoryCompactionProviderState | null> {
    const hadCompactedSummary = hasHistoryCompactionContent(state.summary)
    let nextSummary = state.summary
    let nextSummarySentAt = state.summarySentAt
    let nextTail = [...state.tail]
    let nextNewMessagesSinceCompaction = state.newMessagesSinceCompaction
    let compactedBatches = 0
    let compactedMessages = 0

    while (
      hadCompactedSummary
        ? nextNewMessagesSinceCompaction >= config.compactionBatchSize
        : nextTail.length >= config.historyLimit
    ) {
      const batch = nextTail.slice(0, config.compactionBatchSize)

      LogHelper.title(this.name)
      LogHelper.debug(
        `History compaction triggering: batch=${batch.length} tail=${nextTail.length} threshold=${
          hadCompactedSummary
            ? config.compactionBatchSize
            : config.historyLimit
        } new_messages=${nextNewMessagesSinceCompaction}`
      )

      const compactedSummary = await this.compactHistoryLogs(batch, nextSummary)

      if (!compactedSummary || !hasHistoryCompactionContent(compactedSummary)) {
        return null
      }

      nextSummary = compactedSummary
      nextSummarySentAt =
        batch[batch.length - 1]?.sentAt ?? nextSummarySentAt ?? Date.now()
      nextTail = nextTail.slice(config.compactionBatchSize)
      if (hadCompactedSummary) {
        nextNewMessagesSinceCompaction = Math.max(
          0,
          nextNewMessagesSinceCompaction - batch.length
        )
      }
      compactedBatches += 1
      compactedMessages += batch.length
    }

    if (compactedBatches > 0) {
      LogHelper.title(this.name)
      LogHelper.debug(
        `History compaction advanced: batches=${compactedBatches} absorbed=${compactedMessages} remaining=${nextTail.length}`
      )
    }

    return {
      summary: nextSummary,
      summarySentAt: nextSummarySentAt,
      tail: nextTail,
      newMessagesSinceCompaction: hadCompactedSummary
        ? nextNewMessagesSinceCompaction
        : 0
    }
  }

  public async prepareHistoryCompactionAfterAnswer(
    planWidgetId: string,
    trackedSteps: TrackedPlanStep[]
  ): Promise<PostTurnMaintenanceTask | null> {
    const historyConfig = this.getHistoryCompactionConfig()
    const historyScope = this.getHistoryCompactionScope()
    const conversationLogs = this.getHistoryEligibleConversationLogs(
      await CONVERSATION_LOGGER.loadAll()
    )
    const currentState = this.loadHistoryCompactionProviderState(historyScope)
    const synchronizedState = this.synchronizeHistoryCompactionState(
      conversationLogs,
      currentState
    )

    if (synchronizedState.shouldPersist) {
      this.saveHistoryCompactionProviderState(historyScope, synchronizedState.state)
    }

    const stateToCompact = this.getStateForPostAnswerCompaction(
      conversationLogs,
      synchronizedState.state
    )

    const shouldCompact = hasHistoryCompactionContent(stateToCompact.summary)
      ? stateToCompact.newMessagesSinceCompaction >=
        historyConfig.compactionBatchSize
      : stateToCompact.tail.length >= historyConfig.historyLimit

    if (!shouldCompact) {
      return null
    }

    return async () => {
      const compactionWidgetSteps = [
        ...trackedSteps.map((step) => ({ ...step })),
        {
          label: 'Compacting history...',
          status: 'in_progress' as PlanStepStatus
        }
      ]

      emitPlanWidget(compactionWidgetSteps, null, planWidgetId, true, null)

      const compactedState = await this.rollHistoryCompactionState(
        stateToCompact,
        historyConfig
      )

      if (!compactedState) {
        emitPlanWidget(trackedSteps, null, planWidgetId, true, null)
        return
      }

      this.saveHistoryCompactionProviderState(historyScope, compactedState)
      compactionWidgetSteps[compactionWidgetSteps.length - 1]!.status = 'completed'
      emitPlanWidget(compactionWidgetSteps, null, planWidgetId, true, null)
    }
  }

  private buildHistoryFromCompactionState(
    state: AgentHistoryCompactionProviderState
  ): MessageLog[] {
    if (!state.summary || !hasHistoryCompactionContent(state.summary)) {
      return [...state.tail]
    }

    const summaryMessage: MessageLog = {
      who: 'leon',
      sentAt: state.summarySentAt ?? state.tail[0]?.sentAt ?? Date.now(),
      message: buildCompactedHistoryMessage(state.summary),
      isAddedToHistory: true
    }

    return [summaryMessage, ...state.tail]
  }

  private buildPreparedHistory(history: MessageLog[]): PreparedAgentHistory {
    return {
      messageLogs: history
    }
  }

  private async compactHistoryLogs(
    logsToCompact: MessageLog[],
    previousSummary: string | null
  ): Promise<string | null> {
    if (logsToCompact.length === 0) {
      return null
    }

    const prompt = formatHistoryForCompaction(previousSummary, logsToCompact)
    const baseCompletionParams = {
      dutyType: LLMDuties.ReAct,
      systemPrompt: AGENT_HISTORY_COMPACTION_SYSTEM_PROMPT,
      temperature: 0,
      disableThinking: true,
      trackProviderErrors: false
    }

    const maxTokenBudgets = [
      AGENT_HISTORY_COMPACTION_MAX_TOKENS,
      AGENT_HISTORY_COMPACTION_RETRY_MAX_TOKENS
    ]

    for (const maxTokens of maxTokenBudgets) {
      try {
        const result = await LLM_PROVIDER.prompt(prompt, {
          ...baseCompletionParams,
          maxTokens
        })

        const normalized = normalizeHistoryCompactionSummary(result?.output)
        if (normalized && hasHistoryCompactionContent(normalized)) {
          return normalized
        }

        if (maxTokens !== maxTokenBudgets[maxTokenBudgets.length - 1]) {
          LogHelper.title(this.name)
          LogHelper.warning(
            `History compaction returned invalid structured output; retrying with maxTokens=${AGENT_HISTORY_COMPACTION_RETRY_MAX_TOKENS}`
          )
        }
      } catch (error) {
        if (maxTokens === maxTokenBudgets[maxTokenBudgets.length - 1]) {
          LogHelper.title(this.name)
          LogHelper.warning(
            `History compaction failed; using raw history instead: ${String(error)}`
          )
          return null
        }

        LogHelper.title(this.name)
        LogHelper.warning(
          `History compaction attempt failed; retrying with maxTokens=${AGENT_HISTORY_COMPACTION_RETRY_MAX_TOKENS}: ${String(error)}`
        )
      }
    }

    return null
  }

}
