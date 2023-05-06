/**
 * Action types
 */

export interface ActionParams {
  lang: string
  utterance: string
  current_entities: unknown[] // TODO
  entities: unknown[] // TODO
  current_resolvers: unknown[] // TODO
  resolvers: unknown[] // TODO
  slots: Record<string, unknown>[] // TODO
}
export type ActionFunction = (params: ActionParams) => Promise<void>

export interface IntentObject extends ActionParams {
  id: string
  domain: string
  skill: string
  action: string
}

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
