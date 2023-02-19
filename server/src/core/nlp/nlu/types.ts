import type { NEREntity } from '@/core/nlp/ner/types'
import type { NLPAction, NLPDomain, NLPSkill, NLPUtterance } from '@/core/nlp/types'

export interface NLUSlot {
  name: string
  expectedEntity: string
  value: NEREntity
  isFilled: boolean
  questions: string[]
  pickedQuestion: string
}

export interface NLUClassification {
  domain: NLPDomain
  skill: NLPSkill
  action: NLPAction
  confidence: number
}

// TODO
export interface NLUResult {
  currentEntities: NEREntity[]
  entities: NEREntity[]
  currentResolvers: []
  resolvers: []
  slots: ''
  utterance: NLPUtterance
  configDataFilePath: string
  answers: { answer: string }[]
  classification: NLUClassification
}

export type NLUSlots = Record<string, NLUSlot>
