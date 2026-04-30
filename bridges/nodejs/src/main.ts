import path from 'node:path'

import { FileHelper } from '@/helpers/file-helper'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { INTENT_OBJECT, SKILL_PATH } from '@bridge/constants'
import { ParamsHelper } from '@sdk/params-helper'
import { leon } from '@sdk/leon'
import { setToolReporter } from '@sdk/tool-reporter'

const resolveActionFunction = (actionModule: unknown): ActionFunction | null => {
  if (!actionModule || typeof actionModule !== 'object') {
    return null
  }

  const moduleObject = actionModule as Record<string, unknown>

  if (typeof moduleObject['run'] === 'function') {
    return moduleObject['run'] as ActionFunction
  }

  const defaultExport =
    moduleObject['default'] && typeof moduleObject['default'] === 'object'
      ? (moduleObject['default'] as Record<string, unknown>)
      : null

  if (defaultExport && typeof defaultExport['run'] === 'function') {
    return defaultExport['run'] as ActionFunction
  }

  if (typeof moduleObject['default'] === 'function') {
    return moduleObject['default'] as ActionFunction
  }

  return null
}

async function main(): Promise<void> {
  setToolReporter(async (input) => {
    await leon.answer(input)
  })

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
        SKILL_PATH,
        'src',
        'actions',
        `${action_name}.ts`
      )
    )
    const actionFunction = resolveActionFunction(actionModule)

    if (!actionFunction) {
      throw new TypeError(
        `Action "${skill_name}:${action_name}" does not export a runnable action function`
      )
    }

    const paramsHelper = new ParamsHelper(params)

    await actionFunction(params, paramsHelper)
  } catch (e) {
    console.error(
      `Error while running "${skill_name}" skill "${action_name}" action:`,
      e
    )
  }
}

void main()
