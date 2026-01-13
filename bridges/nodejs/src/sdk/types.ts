/**
 * Action types
 */
import type {
  ActionParams,
  IntentObject,
  SkillAnswerCoreData,
  SkillAnswerOutput
} from '@/core/brain/types'
import type { SkillAnswerConfigSchema } from '@/schemas/skill-schemas'

import type { Widget } from '@sdk/widget'
import { ParamsHelper } from '@sdk/params-helper'

export type { ActionParams, IntentObject }

export * from '@/core/nlp/types'

export type ActionFunction = (
  params: ActionParams,
  paramsHelper: ParamsHelper
) => Promise<void>

/**
 * Answer types
 */
export interface Answer {
  key?: string
  widget?: Widget
  data?: AnswerData
  core?: SkillAnswerCoreData
  replaceMessageId?: string | null
}
export interface TextAnswer extends Answer {
  key: string
}
export interface WidgetAnswer extends Answer {
  widget: Widget
  key?: string
}
export type AnswerData = Record<string, string | number> | null
export type AnswerInput = TextAnswer | WidgetAnswer | Answer
export type AnswerOutput = SkillAnswerOutput
export type AnswerConfig = SkillAnswerConfigSchema
