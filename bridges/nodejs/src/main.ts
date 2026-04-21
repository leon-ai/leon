import path from 'node:path'
import url from 'node:url'
import { createRequire, registerHooks } from 'node:module'

import { FileHelper } from '@/helpers/file-helper'

import type { ActionFunction, ActionParams } from '@sdk/types'
import {
  INTENT_OBJECT,
  PROFILE_SKILLS_PATH,
  SKILLS_PATH
} from '@bridge/constants'
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

const isBarePackageImport = (specifier: string): boolean => {
  return !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !specifier.startsWith('node:') &&
    !specifier.startsWith('file:')
}

const isLeonAliasImport = (specifier: string): boolean => {
  return specifier.startsWith('@/') ||
    specifier.startsWith('@bridge/') ||
    specifier.startsWith('@sdk/') ||
    specifier.startsWith('@@/')
}

const registerSkillRuntimeNodeModules = (skillName: string): void => {
  const runtimeNodeModulesPath = path.join(
    PROFILE_SKILLS_PATH,
    skillName,
    '.runtime',
    'node_modules'
  )

  if (!FileHelper.isExistingPath(runtimeNodeModulesPath)) {
    return
  }

  const runtimeRequire = createRequire(
    path.join(runtimeNodeModulesPath, '__resolver__.cjs')
  )

  // Keep Leon aliases and relative imports on the default path, and only
  // redirect bare package imports to the skill-local runtime dependencies.
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!isBarePackageImport(specifier) || isLeonAliasImport(specifier)) {
        return nextResolve(specifier, context)
      }

      try {
        const resolvedPath = runtimeRequire.resolve(specifier)

        return {
          shortCircuit: true,
          url: url.pathToFileURL(resolvedPath).href
        }
      } catch {
        return nextResolve(specifier, context)
      }
    }
  })
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

  registerSkillRuntimeNodeModules(skill_name)

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
        SKILLS_PATH,
        skill_name,
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
