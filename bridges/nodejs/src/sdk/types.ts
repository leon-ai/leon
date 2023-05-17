/**
 * Action types
 */
import type { ActionParams, IntentObject } from '@/core/brain/types'
import type { AnswerConfigSchema } from '@/schemas/skill-schemas'

export type { ActionParams, IntentObject }

export type ActionFunction = (params: ActionParams) => Promise<void>

/**
 * Answer types
 */
export interface AnswerOutput extends IntentObject {
  output: {
    codes: string
    speech: string
    core?: AnswerCoreData
    widget?: unknown // TODO
    options: Record<string, string>
  }
}
export interface AnswerCoreData {
  restart?: boolean
  isInActionLoop?: boolean
  showNextActionSuggestions?: boolean
  showSuggestions?: boolean
}
export interface Answer {
  key?: string
  widget?: unknown // TODO
  data?: AnswerData
  core?: AnswerCoreData
}
export interface TextAnswer extends Answer {
  key: string
}
export interface WidgetAnswer extends Answer {
  widget: unknown
  key?: string
}
export type AnswerData = Record<string, string | number> | null
export type AnswerInput = TextAnswer | WidgetAnswer
export type AnswerConfig = AnswerConfigSchema
