import path from 'node:path'

import { getIntentObject } from '@bridge/utils'
;(async (): Promise<void> => {
  const {
    domain,
    skill,
    action,
    lang,
    utterance,
    current_entities: currentEntities,
    entities,
    current_resolvers: currentResolvers,
    resolvers,
    slots
  } = await getIntentObject()

  const params = {
    lang,
    utterance,
    currentEntities,
    entities,
    currentResolvers,
    resolvers,
    slots
  }

  try {
    const { [action]: actionFunction } = await import(
      path.join(
        process.cwd(),
        'skills',
        domain,
        skill,
        'src',
        'actions',
        `${action}.ts`
      )
    )

    actionFunction(params)
  } catch (e) {
    console.error('Error while running action:', e)
  }
})()
