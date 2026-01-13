import path from 'node:path'

import { FileHelper } from '@/helpers/file-helper'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { INTENT_OBJECT } from '@bridge/constants'
import { ParamsHelper } from '@sdk/params-helper'
;(async (): Promise<void> => {
  const {
    lang,
    sentiment,
    context_name,
    skill_name,
    action_name,
    skill_config_path,
    extra_context
  } = INTENT_OBJECT

  const params: ActionParams = {
    lang,
    utterance: INTENT_OBJECT.utterance as ActionParams['utterance'],
    action_arguments:
      INTENT_OBJECT.action_arguments as ActionParams['action_arguments'],
    entities: INTENT_OBJECT.entities as ActionParams['entities'],
    sentiment,
    context_name,
    skill_name,
    action_name,
    context: INTENT_OBJECT.context as ActionParams['context'],
    skill_config: INTENT_OBJECT.skill_config as ActionParams['skill_config'],
    skill_config_path,
    extra_context
  }

  try {
    const actionModule = await FileHelper.dynamicImportFromFile(
      path.join(
        process.cwd(),
        'skills',
        skill_name,
        'src',
        'actions',
        `${action_name}.ts`
      )
    )
    const actionFunction: ActionFunction = actionModule.run
    const paramsHelper = new ParamsHelper(params)

    await actionFunction(params, paramsHelper)
  } catch (e) {
    console.error(
      `Error while running "${skill_name}" skill "${action_name}" action:`,
      e
    )
  }
})()
