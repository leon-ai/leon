/**
 * Contain common/shared types that are universal across the project
 * and cannot be placed in the respective core nodes
 */

/**
 * Language
 */

/**
 * ISO 639-1 (Language codes) - ISO 3166-1 (Country Codes)
 * @see https://www.iso.org/iso-639-language-codes.html
 * @see https://www.iso.org/iso-3166-country-codes.html
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { default: LANG_CONFIGS } = await import('@@/core/langs.json', {
  with: { type: 'json' }
})

export type Languages = typeof LANG_CONFIGS
export type LongLanguageCode = keyof Languages
export type Language = Languages[LongLanguageCode]
export type ShortLanguageCode = Language['short']

/**
 * System
 */

export enum OSTypes {
  Windows = 'windows',
  MacOS = 'macos',
  Linux = 'linux',
  Unknown = 'unknown'
}
export enum CPUArchitectures {
  X64 = 'x64',
  ARM64 = 'arm64'
}

/**
 * Routing mode
 */
export enum RoutingMode {
  Smart = 'smart',
  Controlled = 'controlled',
  Agent = 'agent'
}

/**
 * Skill package format.
 */
export enum SkillFormat {
  LeonNative = 'leon-native',
  AgentSkill = 'agent-skill'
}

/**
 * Mood
 */
export enum Moods {
  Default = 'default',
  Tired = 'tired',
  Sad = 'sad',
  Angry = 'angry',
  Cocky = 'cocky'
}

/**
 * Logger
 */

export type ConversationWidgetHistoryMode = 'persisted' | 'system_widget'
export type ConversationItemSource = 'conversation_history' | 'system_widget'

export interface ConversationWidgetData {
  actionName: string
  widget: string
  id: string
  componentTree: Record<string, unknown>
  supportedEvents: string[]
  onFetch: {
    widgetId?: string
    actionName: string
  } | null
  fallbackText: string
  historyMode: ConversationWidgetHistoryMode
}

export interface LLMAnswerMetrics {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  finalAnswerOutputTokens?: number
  durationMs: number
  finalAnswerDurationMs?: number
  finalAnswerTokensPerSecond?: number
  finalAnswerCharsPerSecond?: number
  outputCharsPerSecond?: number
  averagedPhaseTokensPerSecond?: number
  phaseMetrics?: {
    planning: { outputTokens: number, durationMs: number, tokensPerSecond: number }
    execution: { outputTokens: number, durationMs: number, tokensPerSecond: number }
    recovery: { outputTokens: number, durationMs: number, tokensPerSecond: number }
    final_answer: { outputTokens: number, durationMs: number, tokensPerSecond: number }
  }
  turnInputTokens?: number
  turnOutputTokens?: number
  turnTotalTokens?: number
  ttftMs?: number
  tokensPerSecond: number
}

export interface MessageLog {
  who: 'owner' | 'leon'
  sentAt: number
  message: string
  isAddedToHistory: boolean
  messageId?: string
  widget?: ConversationWidgetData | null
  llmMetrics?: LLMAnswerMetrics
}

export interface ConversationHistoryItem {
  who: MessageLog['who']
  sentAt: number
  string: string
  originalString: string
  source: ConversationItemSource
  messageId?: string
  llmMetrics?: LLMAnswerMetrics
}
