import type { SkillAnswerConfigSchema } from '@/schemas/skill-schemas'
import type {
  ConversationHistoryItem,
  LLMAnswerMetrics,
  ConversationWidgetData,
  MessageLog
} from '@/types'

const SYSTEM_WIDGET_HISTORY_MODE = 'system_widget'

export class ConversationHistoryHelper {
  private static normalizeMetricNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null
    }

    return value
  }

  private static normalizeLLMAnswerMetrics(
    metrics: unknown
  ): LLMAnswerMetrics | null {
    if (!metrics || typeof metrics !== 'object') {
      return null
    }

    const record = metrics as Record<string, unknown>
    const inputTokens = this.normalizeMetricNumber(record['inputTokens'])
    const outputTokens = this.normalizeMetricNumber(record['outputTokens'])
    const totalTokens = this.normalizeMetricNumber(record['totalTokens'])
    const durationMs = this.normalizeMetricNumber(record['durationMs'])
    const tokensPerSecond = this.normalizeMetricNumber(record['tokensPerSecond'])

    if (
      inputTokens === null ||
      outputTokens === null ||
      totalTokens === null ||
      durationMs === null ||
      tokensPerSecond === null
    ) {
      return null
    }

    const normalizedMetrics: LLMAnswerMetrics = {
      inputTokens,
      outputTokens,
      totalTokens,
      durationMs,
      tokensPerSecond
    }

    const optionalNumberKeys = [
      'finalAnswerOutputTokens',
      'finalAnswerDurationMs',
      'finalAnswerTokensPerSecond',
      'finalAnswerCharsPerSecond',
      'outputCharsPerSecond',
      'averagedPhaseTokensPerSecond',
      'turnInputTokens',
      'turnOutputTokens',
      'turnTotalTokens',
      'ttftMs'
    ] as const

    for (const key of optionalNumberKeys) {
      const normalizedValue = this.normalizeMetricNumber(record[key])
      if (normalizedValue !== null) {
        normalizedMetrics[key] = normalizedValue
      }
    }

    if (record['phaseMetrics'] && typeof record['phaseMetrics'] === 'object') {
      const phaseMetricsRecord = record['phaseMetrics'] as Record<string, unknown>
      const phaseNames = ['planning', 'execution', 'recovery', 'final_answer'] as const
      const normalizedPhaseMetrics = {} as NonNullable<
        LLMAnswerMetrics['phaseMetrics']
      >
      let hasAllPhaseMetrics = true

      for (const phaseName of phaseNames) {
        const phaseValue = phaseMetricsRecord[phaseName]
        if (!phaseValue || typeof phaseValue !== 'object') {
          hasAllPhaseMetrics = false
          break
        }

        const phaseRecord = phaseValue as Record<string, unknown>
        const phaseOutputTokens = this.normalizeMetricNumber(
          phaseRecord['outputTokens']
        )
        const phaseDurationMs = this.normalizeMetricNumber(
          phaseRecord['durationMs']
        )
        const phaseTokensPerSecond = this.normalizeMetricNumber(
          phaseRecord['tokensPerSecond']
        )

        if (
          phaseOutputTokens === null ||
          phaseDurationMs === null ||
          phaseTokensPerSecond === null
        ) {
          hasAllPhaseMetrics = false
          break
        }

        normalizedPhaseMetrics[phaseName] = {
          outputTokens: phaseOutputTokens,
          durationMs: phaseDurationMs,
          tokensPerSecond: phaseTokensPerSecond
        }
      }

      if (hasAllPhaseMetrics) {
        normalizedMetrics.phaseMetrics = normalizedPhaseMetrics
      }
    }

    return normalizedMetrics
  }

  /**
   * Normalize any answer config to a text value suitable for history
   * and widget fallback delivery.
   */
  public static getAnswerText(
    answer: SkillAnswerConfigSchema | string | null | undefined
  ): string {
    if (!answer) {
      return ''
    }

    if (typeof answer === 'string') {
      return answer
    }

    return answer.text || answer.speech || ''
  }

  public static isWidgetPersisted(
    widget: ConversationWidgetData | null | undefined
  ): boolean {
    return !!widget
  }

  public static isAddedToHistory(
    conversationLog: Pick<MessageLog, 'isAddedToHistory'>
  ): boolean {
    return conversationLog.isAddedToHistory === true
  }

  public static isSystemWidget(
    widget: ConversationWidgetData | null | undefined
  ): boolean {
    return widget?.historyMode === SYSTEM_WIDGET_HISTORY_MODE
  }

  public static serializeWidget(widget: ConversationWidgetData): string {
    return JSON.stringify(widget)
  }

  public static toHistoryItems(
    conversationLogs: MessageLog[],
    options: {
      supportsWidgets: boolean
      source?: ConversationHistoryItem['source']
    }
  ): ConversationHistoryItem[] {
    return conversationLogs.map((conversationLog) => {
      const bubbleString =
        options.supportsWidgets && conversationLog.widget
          ? this.serializeWidget(conversationLog.widget)
          : conversationLog.message
      const llmMetrics = conversationLog.llmMetrics
        ? this.normalizeLLMAnswerMetrics(conversationLog.llmMetrics)
        : null

      return {
        who: conversationLog.who,
        sentAt: conversationLog.sentAt,
        string: bubbleString,
        originalString: bubbleString,
        source: options.source || 'conversation_history',
        ...(llmMetrics ? { llmMetrics } : {}),
        ...(conversationLog.messageId
          ? { messageId: conversationLog.messageId }
          : {})
      }
    })
  }
}
