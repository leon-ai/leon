import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { INTENT_OBJECT, MEMORY } from '@bridge/constants'
;(async (): Promise<void> => {
  const {
    domain,
    skill,
    action,
    lang,
    utterance,
    current_entities,
    entities,
    current_resolvers,
    resolvers,
    slots
  } = INTENT_OBJECT

  const params: ActionParams = {
    lang,
    utterance,
    current_entities,
    entities,
    current_resolvers,
    resolvers,
    slots
  }

  try {
    await MEMORY.init()

    const actionModule = await import(
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
    const actionFunction: ActionFunction = actionModule[action]

    await actionFunction(params)
  } catch (e) {
    console.error(`Error while running "${skill}" skill "${action}" action:`, e)
  }
})()
