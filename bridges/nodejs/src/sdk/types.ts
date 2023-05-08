/**
 * Action types
 */
import type { ActionParams, IntentObject } from '@/core/brain/types'

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
    options: Record<string, string>
  }
}
export interface AnswerCoreData {
  restart?: boolean
  isInActionLoop?: boolean
  showNextActionSuggestions?: boolean
  showSuggestions?: boolean
}
export interface TextAnswer {
  key: string
  data?: AnswerData
  core?: AnswerCoreData
}
export interface WidgetAnswer {
  // TODO
  key: 'widget'
  data?: AnswerData
  core?: AnswerCoreData
}
export type AnswerData = Record<string, string | number> | null
export type AnswerInput = TextAnswer | WidgetAnswer
