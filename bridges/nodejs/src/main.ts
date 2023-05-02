import fs from 'node:fs'
import path from 'node:path'

const {
  argv: [, , INTENT_OBJ_FILE_PATH]
} = process

;(async (): Promise<void> => {
  if (INTENT_OBJ_FILE_PATH) {
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
    } = JSON.parse(await fs.promises.readFile(INTENT_OBJ_FILE_PATH, 'utf8'))

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

      const speech = actionFunction(params)

      console.log(
        JSON.stringify({
          domain,
          skill,
          action,
          lang,
          utterance,
          entities,
          slots,
          // TODO
          output: {
            type: 'end',
            codes: '',
            speech,
            core: {},
            options: {}
          }
        })
      )
    } catch (e) {
      console.error('Error while running action:', e)
    }
  }
})()
