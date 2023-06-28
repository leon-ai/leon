import type { ShortLanguageCode } from '@/types'
import type { BrainProcessResult } from '@/core/brain/types'

/**
 * NLP types
 */

export type NLPDomain = string
export type NLPSkill = string
export type NLPAction = string
export type NLPUtterance = string

export type NLUProcessResult = Partial<
  BrainProcessResult & {
    processingTime: number
    nluProcessingTime: number
  }
>

export interface NLPJSProcessResult {
  locale: ShortLanguageCode
  utterance: NLPUtterance
  settings: unknown
  languageGuessed: boolean
  localeIso2: ShortLanguageCode
  language: string
  explanation: []
  classifications: {
    intent: string
    score: number
  }[]
  intent: string // E.g. "greeting.run"
  score: number
  domain: NLPDomain
  sourceEntities: unknown[]
  entities: NEREntity[]
  answers: {
    answer: string
  }[]
  answer: string | undefined
  actions: NLPAction[]
  sentiment: {
    // Rule of thumb: > 0 = negative; = 0 = neutral; < 0 = positive
    score: number
    numWords: number
    numHits: number
    average: number
    type: string
    locale: ShortLanguageCode
    vote: 'positive' | 'neutral' | 'negative'
  }
}

/**
 * NLU types
 */

export interface NLUSlot {
  name: string
  expectedEntity: string
  value: NEREntity
  isFilled: boolean
  questions: string[]
  pickedQuestion: string
  locales?: Record<string, string[]> // From NLP.js
}

export interface NLUClassification {
  domain: NLPDomain
  skill: NLPSkill
  action: NLPAction
  confidence: number
}

export interface NLUResolver {
  name: string
  value: string
}

export interface NLUResult {
  currentEntities: NEREntity[]
  entities: NEREntity[]
  currentResolvers: NLUResolver[]
  resolvers: NLUResolver[]
  slots: NLUSlots
  utterance: NLPUtterance
  skillConfigPath: string
  answers: { answer: string }[]
  sentiment: {
    vote?: NLPJSProcessResult['sentiment']['vote']
    score?: NLPJSProcessResult['sentiment']['score']
  }
  classification: NLUClassification
}

export type NLUSlots = Record<string, NLUSlot>

/**
 * NER types
 */

/* eslint-disable @typescript-eslint/no-empty-interface */

interface Entity {
  start: number
  end: number
  len: number
  accuracy: number
  sourceText: string
  utteranceText: string
  entity: unknown
  resolution: unknown
}

/**
 * Built-in entity types
 */

export interface BuiltInEntity extends Entity {}

export interface BuiltInNumberEntity extends BuiltInEntity {
  resolution: {
    strValue: string
    value: number
    subtype: string
  }
}
export interface BuiltInIPEntity extends BuiltInEntity {
  resolution: {
    value: string
    type: string
  }
}
export interface BuiltInHashtagEntity extends BuiltInEntity {
  resolution: {
    value: string
  }
}
export interface BuiltInPhoneNumberEntity extends BuiltInEntity {
  resolution: {
    value: string
    score: string
  }
}
export interface BuiltInCurrencyEntity extends BuiltInEntity {
  resolution: {
    strValue: string
    value: number
    unit: string
    localeUnit: string
  }
}
export interface BuiltInPercentageEntity extends BuiltInEntity {
  resolution: {
    strValue: string
    value: number
    subtype: string
  }
}
export interface BuiltInDateEntity extends BuiltInEntity {
  resolution: {
    type: string
    timex: string
    strPastValue: string
    pastDate: string
    strFutureValue: string
    futureDate: string
  }
}
export interface BuiltInTimeEntity extends BuiltInEntity {
  resolution: {
    values: {
      timex: string
      type: string
      value: string
    }[]
  }
}
export interface BuiltInTimeRangeEntity extends BuiltInEntity {
  resolution: {
    values: {
      timex: string
      type: string
      start: string
      end: string
    }[]
  }
}
export interface BuiltInDateRangeEntity extends BuiltInEntity {
  resolution: {
    type: string
    timex: string
    strPastStartValue: string
    pastStartDate: string
    strPastEndValue: string
    pastEndDate: string
    strFutureStartValue: string
    futureStartDate: string
    strFutureEndValue: string
    futureEndDate: string
  }
}
export interface BuiltInDateTimeRangeEntity extends BuiltInEntity {
  resolution: {
    type: string
    timex: string
    strPastStartValue: string
    pastStartDate: string
    strPastEndValue: string
    pastEndDate: string
    strFutureStartValue: string
    futureStartDate: string
    strFutureEndValue: string
    futureEndDate: string
  }
}
export interface BuiltInDurationEntity extends BuiltInEntity {
  resolution: {
    values: {
      timex: string
      type: string
      value: string
    }[]
  }
}
export interface BuiltInDimensionEntity extends BuiltInEntity {
  resolution: {
    strValue: string
    value: number
    unit: string
    localeUnit: string
  }
}
export interface BuiltInEmailEntity extends BuiltInEntity {
  resolution: {
    value: string
  }
}
export interface BuiltInOrdinalEntity extends BuiltInEntity {
  resolution: {
    strValue: string
    value: number
    subtype: string
  }
}
export interface BuiltInAgeEntity extends BuiltInEntity {
  resolution: {
    strValue: string
    value: number
    unit: string
    localeUnit: string
  }
}
export interface BuiltInURLEntity extends BuiltInEntity {
  resolution: {
    value: string
  }
}
export interface BuiltInTemperatureEntity extends BuiltInEntity {
  resolution: {
    strValue: string
    value: number
    unit: string
    localeUnit: string
  }
}

/**
 * Custom entity types
 */

interface CustomEntity<T> extends Entity {
  type: T
}

export interface CustomEnumEntity extends CustomEntity<'enum'> {
  levenshtein: number
  option: string
  resolution: {
    value: string
  }
  alias?: string // E.g. "location:country_0"; "location:country_1"
}
type GlobalEntity = CustomEnumEntity
export interface CustomRegexEntity extends CustomEntity<'regex'> {
  resolution: {
    value: string
  }
}
interface CustomTrimEntity extends CustomEntity<'trim'> {
  subtype:
    | 'between'
    | 'after'
    | 'afterFirst'
    | 'afterLast'
    | 'before'
    | 'beforeFirst'
    | 'beforeLast'
  resolution: {
    value: string
  }
}

/**
 * spaCy's entity types
 */

interface SpacyEntity<T> extends CustomEnumEntity {
  entity: T
}

interface SpacyLocationCountryEntity extends SpacyEntity<'location:country'> {}
interface SpacyLocationCityEntity extends SpacyEntity<'location:city'> {}
interface SpacyPersonEntity extends SpacyEntity<'person'> {}
interface SpacyOrganizationEntity extends SpacyEntity<'organization'> {}

/**
 * Exported entity types
 */

export type NERBuiltInEntity =
  | BuiltInNumberEntity
  | BuiltInIPEntity
  | BuiltInHashtagEntity
  | BuiltInPhoneNumberEntity
  | BuiltInCurrencyEntity
  | BuiltInPercentageEntity
  | BuiltInDateEntity
  | BuiltInTimeEntity
  | BuiltInTimeRangeEntity
  | BuiltInDateRangeEntity
  | BuiltInDateTimeRangeEntity
  | BuiltInDurationEntity
  | BuiltInDimensionEntity
  | BuiltInEmailEntity
  | BuiltInOrdinalEntity
  | BuiltInAgeEntity
  | BuiltInURLEntity
  | BuiltInTemperatureEntity

export type NERCustomEntity =
  | CustomEnumEntity
  | CustomRegexEntity
  | CustomTrimEntity

export type NERGlobalEntity = GlobalEntity

export type NERSpacyEntity =
  | SpacyLocationCountryEntity
  | SpacyLocationCityEntity
  | SpacyPersonEntity
  | SpacyOrganizationEntity

export type NEREntity =
  | NERBuiltInEntity
  | NERCustomEntity
  | NERGlobalEntity
  | NERSpacyEntity
