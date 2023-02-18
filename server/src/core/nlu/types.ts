// TODO
export interface NLUResult {
  currentEntities: [],
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
