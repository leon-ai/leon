/**
 * Built-in entity types still used for schema typing.
 */

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

export const CUSTOM_ENTITY_TYPES = ['regex', 'trim', 'enum', 'llm'] as const

export type CustomEntityType = (typeof CUSTOM_ENTITY_TYPES)[number]

export const ENTITY_TYPES = [...BUILT_IN_ENTITY_TYPES, ...CUSTOM_ENTITY_TYPES] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

