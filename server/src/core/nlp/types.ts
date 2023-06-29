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
  /** E.g. "greeting.run" */
  intent: string
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
    /** Rule of thumb: > 0 = negative; = 0 = neutral; < 0 = positive */
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

export const BUILT_IN_ENTITY_TYPES = [
  'number',
  'ip',
  'hashtag',
  'phonenumber',
  'currency',
  'percentage',
  'date',
  'time',
  'timerange',
  'daterange',
  'datetimerange',
  'duration',
  'dimension',
  'email',
  'ordinal',
  'age',
  'url',
  'temperature'
] as const

export type BuiltInEntityType = (typeof BUILT_IN_ENTITY_TYPES)[number]

export const CUSTOM_ENTITY_TYPES = ['regex', 'trim', 'enum'] as const

export type CustomEntityType = (typeof CUSTOM_ENTITY_TYPES)[number]

export const SPACY_ENTITY_TYPES = [
  'location:country',
  'location:city',
  'person',
  'organization'
] as const

export type SpacyEntityType = (typeof SPACY_ENTITY_TYPES)[number]

export const ENTITY_TYPES = [
  ...BUILT_IN_ENTITY_TYPES,
  ...CUSTOM_ENTITY_TYPES,
  ...SPACY_ENTITY_TYPES
] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

interface Entity<
  Type extends EntityType,
  Resolution extends Record<string, unknown>,
  EntityName extends string = Type
> {
  start: number
  end: number
  len: number
  accuracy: number
  sourceText: string
  utteranceText: string
  entity: EntityName
  type: Type
  resolution: Resolution
}

/**
 * Built-in entity types
 */

export interface BuiltInEntity<
  Type extends BuiltInEntityType,
  Resolution extends Record<string, unknown>
> extends Entity<Type, Resolution> {}

export type BuiltInNumberEntity = BuiltInEntity<
  'number',
  {
    strValue: string
    value: number
    subtype: string
  }
>
export type BuiltInIPEntity = BuiltInEntity<
  'ip',
  {
    value: string
    type: 'ipv4' | 'ipv6'
  }
>
export type BuiltInHashtagEntity = BuiltInEntity<
  'hashtag',
  {
    value: string
  }
>
export type BuiltInPhoneNumberEntity = BuiltInEntity<
  'phonenumber',
  {
    value: string
    score: string
  }
>
export type BuiltInCurrencyEntity = BuiltInEntity<
  'currency',
  {
    strValue: string
    value: number
    unit: string
    localeUnit: string
  }
>
export type BuiltInPercentageEntity = BuiltInEntity<
  'percentage',
  {
    strValue: string
    value: number
    subtype: string
  }
>

export type BuiltInDateEntity = BuiltInEntity<
  'date',
  | {
      type: 'date'
      timex: string
      strValue: string
      date: string
    }
  | {
      type: 'interval'
      timex: string
      strPastValue: string
      pastDate: string
      strFutureValue: string
      futureDate: string
    }
>
export type BuiltInTimeEntity = BuiltInEntity<
  'time',
  {
    values: {
      timex: string
      type: string
      value: string
    }[]
  }
>
export type BuiltInTimeRangeEntity = BuiltInEntity<
  'timerange',
  {
    values: {
      timex: string
      type: string
      start: string
      end: string
    }[]
  }
>
export type BuiltInDateRangeEntity = BuiltInEntity<
  'daterange',
  {
    type: 'interval'
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
>
export type BuiltInDateTimeRangeEntity = BuiltInEntity<
  'datetimerange',
  {
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
>
export type BuiltInDurationEntity = BuiltInEntity<
  'duration',
  {
    values: {
      timex: string
      type: string
      Mod?: 'before' | 'after'
      value: string
    }[]
  }
>
export type BuiltInDimensionEntity = BuiltInEntity<
  'dimension',
  {
    strValue: string
    value: number
    unit: string
    localeUnit: string
  }
>
export type BuiltInEmailEntity = BuiltInEntity<
  'email',
  {
    value: string
  }
>
export type BuiltInOrdinalEntity = BuiltInEntity<
  'ordinal',
  {
    strValue: string
    value: number
    subtype: string
  }
>
export type BuiltInAgeEntity = BuiltInEntity<
  'age',
  {
    strValue: string
    value: number
    unit: string
    localeUnit: string
  }
>
export type BuiltInURLEntity = BuiltInEntity<
  'url',
  {
    value: string
  }
>
export type BuiltInTemperatureEntity = BuiltInEntity<
  'temperature',
  {
    strValue: string
    value: number
    unit: string
    localeUnit: string
  }
>

/**
 * Custom entity types
 */

interface CustomEntity<
  Type extends CustomEntityType | SpacyEntityType,
  Resolution extends Record<string, unknown> = { value: string }
> extends Entity<Type, Resolution, string> {}

export interface CustomEnumEntity<
  Type extends CustomEntityType | SpacyEntityType = 'enum',
  Resolution extends Record<string, unknown> = { value: string }
> extends CustomEntity<Type, Resolution> {
  levenshtein: number
  option: string
  /** E.g. "location:country_0"; "location:country_1" */
  alias?: string
}
type GlobalEntity = CustomEnumEntity
export interface CustomRegexEntity extends CustomEntity<'regex'> {}
interface CustomTrimEntity extends CustomEntity<'trim'> {
  subtype:
    | 'between'
    | 'after'
    | 'afterFirst'
    | 'afterLast'
    | 'before'
    | 'beforeFirst'
    | 'beforeLast'
}

/**
 * spaCy's entity types
 */

interface SpacyEntity<
  T extends SpacyEntityType,
  Resolution extends Record<string, unknown> = { value: string }
> extends CustomEnumEntity<T, Resolution> {
  entity: T
}

export interface SpacyLocationCountryEntity
  extends SpacyEntity<
    'location:country',
    {
      value: string
      data: {
        name: string
        iso: string
        iso3: string
        isonumeric: number
        continentcode: string
        capital: string
        population: number
        tld: string
        currencycode: string
        currencyname: string
        phone: string
        languages: string
        neighbours: string
      }
    }
  > {}
export interface SpacyLocationCityEntity
  extends SpacyEntity<
    'location:city',
    {
      value: string
      data: {
        geonameid: number
        name: string
        latitude: number
        longitude: number
        countrycode: string
        population: number
        alternatenames: string[]
        time_zone: {
          country_code: string
          id: string
          coordinated_universal_time_offset: number
          daylight_saving_time_offset: number
        }
      }
    }
  > {}
export interface SpacyPersonEntity extends SpacyEntity<'person'> {}
export interface SpacyOrganizationEntity extends SpacyEntity<'organization'> {}

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
