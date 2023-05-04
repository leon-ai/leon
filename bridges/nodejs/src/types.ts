export interface IntentObject {
  id: string
  domain: string
  skill: string
  action: string
  lang: string
  utterance: string
  current_entities: unknown[] // TODO
  entities: unknown[] // TODO
  current_resolvers: unknown[] // TODO
  resolvers: unknown[] // TODO
  slots: Record<string, unknown>[] // TODO
}

export interface AnswerObject extends IntentObject {
  output: {
    codes: string
    speech: string
    core: unknown // TODO
    options: unknown // TODO
  }
}
