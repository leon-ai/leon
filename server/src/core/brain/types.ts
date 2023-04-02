import type {
  NEREntity,
  NLPAction,
  NLPDomain,
  NLPSkill,
  NLPUtterance,
  NLUResolver,
  NLUResult,
  NLUSlot,
  NLUSlots
} from '@/core/nlp/types'
import type { SkillConfigSchema } from '@/schemas/skill-schemas'
import type { ShortLanguageCode } from '@/types'

interface SkillCoreData {
  restart?: boolean
  isInActionLoop?: boolean
  showNextActionSuggestions?: boolean
  showSuggestions?: boolean
}

export interface SkillResult {
  domain: NLPDomain
  skill: NLPSkill
  action: NLPAction
  lang: ShortLanguageCode
  utterance: NLPUtterance
  entities: NEREntity[]
  slots: NLUSlots
  output: {
    type: SkillOutputType
    codes: string[]
    speech: string
    core: SkillCoreData | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: Record<string, any>
  }
}

export enum SkillOutputType {
  Intermediate = 'inter',
  End = 'end'
}
export enum SkillActionType {
  Logic = 'logic',
  Dialog = 'dialog'
}

export interface IntentObject {
  id: string
  lang: ShortLanguageCode
  domain: NLPDomain
  skill: NLPSkill
  action: NLPAction
  utterance: NLPUtterance
  current_entities: NEREntity[]
  entities: NEREntity[]
  current_resolvers: NLUResolver[]
  resolvers: NLUResolver[]
  slots: { [key: string]: NLUSlot['value'] | undefined }
}

export interface BrainProcessResult extends NLUResult {
  speeches: string[]
  executionTime: number
  utteranceId?: string
  lang?: ShortLanguageCode
  core?: SkillCoreData | undefined
  action?: SkillConfigSchema['actions'][string]
  nextAction?: SkillConfigSchema['actions'][string] | null | undefined
}
