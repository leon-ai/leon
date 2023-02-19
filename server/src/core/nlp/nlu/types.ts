import type { NEREntity } from '@/core/nlp/ner/types'

export interface NLUSlot {
  name: string
  expectedEntity: string
  value: NEREntity
  isFilled: boolean
  questions: string[]
  pickedQuestion: string
}

// TODO
export interface NLUResult {
  currentEntities: []
  entities: []
  currentResolvers: []
  resolvers: []
  slots: ''
  utterance: string
  configDataFilePath: string
  classification: {
    domain: string
    skill: string
    action: string
    confidence: number
  }
}

export type NLUSlots = Record<string, NLUSlot>
