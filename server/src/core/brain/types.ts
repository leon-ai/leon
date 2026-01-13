import type {
  NEREntity,
  NLPAction,
  NLPDomain,
  NLPSkill,
  NLPUtterance,
  NLUProcessResult,
  NLUSlots
} from '@/core/nlp/types'
import type {
  SkillConfigSchema,
  SkillAnswerConfigSchema
} from '@/schemas/skill-schemas'
import type { ShortLanguageCode } from '@/types'
import type { WidgetWrapper } from '@sdk/aurora'
import type { SUPPORTED_WIDGET_EVENTS } from '@sdk/widget-component'

export interface SkillResult {
  domain: NLPDomain
  skill: NLPSkill
  action: NLPAction
  lang: ShortLanguageCode
  utterance: NLPUtterance
  entities: NEREntity[]
  slots: NLUSlots
  output: {
    codes: string[]
    answer: string
    core: SkillAnswerCoreData | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: Record<string, any>
    replaceMessageId?: string | null
    widget?: {
      componentTree: WidgetWrapper
      supportedEvents: typeof SUPPORTED_WIDGET_EVENTS
    }
  }
}

export enum SkillBridges {
  Python = 'python',
  NodeJS = 'nodejs'
}
export enum SkillActionTypes {
  Logic = 'logic',
  Dialog = 'dialog'
}

/**
 * What we pass to the action runtime.
 *
 * Try to not use types such as `NLUProcessResult`, etc. Prefer direct type since
 * it is more explicit and easier to understand for skill developers
 */
export interface ActionParams {
  lang: string
  utterance: string
  action_arguments: Record<string, unknown>
  entities: NEREntity[]
  sentiment: NLUProcessResult['new']['sentiment']
  context_name: string
  skill_name: string
  action_name: string
  context: {
    utterances: string[]
    action_arguments: Record<string, unknown>[]
    entities: NEREntity[]
    sentiments: NLUProcessResult['context']['sentiments']
    data: Record<string, unknown>
  }
  skill_config: {
    name: string
    bridge: SkillBridges
    version: string
    flow: string[]
  }
  skill_config_path: string
  extra_context: {
    lang: string
    date: string
    time: string
    timestamp: number
    date_time: string
    week_day: string
  }
}

// TODO: delete
/*export interface ActionParams {
  lang: ShortLanguageCode
  utterance: NLPUtterance
  new_utterance: NLPUtterance
  current_entities: NEREntity[]
  entities: NEREntity[]
  current_resolvers: NLUResolver[]
  resolvers: NLUResolver[]
  slots: { [key: string]: NLUSlot['value'] | undefined }
}*/

export interface IntentObject {
  id: string
  lang: ShortLanguageCode
  context_name: NLUProcessResult['contextName']
  skill_name: NLUProcessResult['skillName']
  action_name: NLUProcessResult['actionName']
  skill_config: {
    name: NLUProcessResult['skillConfig']['name']
    bridge: NLUProcessResult['skillConfig']['bridge']
    version: NLUProcessResult['skillConfig']['version']
    flow: NLUProcessResult['skillConfig']['flow']
  }
  skill_config_path: NLUProcessResult['skillConfigPath']
  utterance: NLUProcessResult['new']['utterance']
  action_arguments: NLUProcessResult['new']['actionArguments']
  entities: NLUProcessResult['new']['entities']
  sentiment: NLUProcessResult['new']['sentiment']
  context: {
    utterances: NLUProcessResult['context']['utterances']
    action_arguments: NLUProcessResult['context']['actionArguments']
    entities: NLUProcessResult['context']['entities']
    sentiments: NLUProcessResult['context']['sentiments']
    data: NLUProcessResult['context']['data']
  }
  extra_context: {
    lang: ShortLanguageCode
    date: string
    time: string
    timestamp: number
    date_time: string
    week_day: string
  }
}

export interface SkillAnswerCoreData {
  is_in_action_loop?: boolean
  next_action?: string
  // Tool-related properties for identifying tool outputs
  isToolOutput?: boolean
  toolkitName?: string
  toolName?: string
  toolGroupId?: string
  // Simple context data pushed by skills (merged into NLU context.data)
  context_data?: Record<string, unknown>
}
export interface SkillAnswerOutput extends IntentObject {
  output: {
    codes: string
    answer: SkillAnswerConfigSchema
    core?: SkillAnswerCoreData
    replaceMessageId?: string | null
    widget?: {
      actionName: string
      widget: string
      id: string
      componentTree: WidgetWrapper
      supportedEvents: typeof SUPPORTED_WIDGET_EVENTS
      onFetch: {
        widgetId?: string
        actionName: string
      } | null
    }
  }
}

export interface BrainProcessResult extends NLUProcessResult {
  speeches: string[]
  executionTime: number
  utteranceId?: string
  lang?: ShortLanguageCode
  core?: SkillAnswerCoreData | undefined
  lastOutputFromSkill?: SkillResult['output'] | undefined
  action?: SkillConfigSchema['actions'][string]
  nextAction?: SkillConfigSchema['actions'][string] | null | undefined
}
