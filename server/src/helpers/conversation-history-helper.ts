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

  private static normalizePhaseMetric(
    value: unknown
  ): NonNullable<LLMAnswerMetrics['phaseMetrics']>['agent'] | null {
    if (!value || typeof value !== 'object') {
      return null
    }

    const record = value as Record<string, unknown>
    const outputTokens = this.normalizeMetricNumber(record['outputTokens'])
    const durationMs = this.normalizeMetricNumber(record['durationMs'])
    const tokensPerSecond = this.normalizeMetricNumber(
      record['tokensPerSecond']
    )

    if (
      outputTokens === null ||
      durationMs === null ||
      tokensPerSecond === null
    ) {
      return null
    }

    return { outputTokens, durationMs, tokensPerSecond }
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
      const finalAnswer = this.normalizePhaseMetric(
        phaseMetricsRecord['final_answer']
      )
      let agent = this.normalizePhaseMetric(phaseMetricsRecord['agent'])

      if (!agent) {
        // Fold stored metrics from the former multi-phase loop into the
        // single agent phase so existing conversation logs remain readable.
        const legacyMetrics = ['planning', 'execution', 'recovery'].map(
          (phase) => this.normalizePhaseMetric(phaseMetricsRecord[phase])
        )
        if (legacyMetrics.every((metric) => metric !== null)) {
          const outputTokens = legacyMetrics.reduce(
            (total, metric) => total + metric!.outputTokens,
            0
          )
          const durationMs = legacyMetrics.reduce(
            (total, metric) => total + metric!.durationMs,
            0
          )
          agent = {
            outputTokens,
            durationMs,
            tokensPerSecond:
              durationMs > 0
                ? Number(((outputTokens / durationMs) * 1_000).toFixed(2))
                : 0
          }
        }
      }

      if (agent && finalAnswer) {
        normalizedMetrics.phaseMetrics = { agent, final_answer: finalAnswer }
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

  public static isRenderableWidget(
    widget: ConversationWidgetData | null | undefined
  ): widget is ConversationWidgetData {
    return !!(widget?.id && widget.widget && widget.componentTree)
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
        options.supportsWidgets &&
        this.isRenderableWidget(conversationLog.widget)
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
          : {}),
        ...(conversationLog.agentResponseTrace
          ? { agentResponseTrace: conversationLog.agentResponseTrace }
          : {})
      }
    })
  }
}
