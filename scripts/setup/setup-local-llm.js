import fs from 'node:fs'
import path from 'node:path'

import {
  LLM_DIR_PATH,
  LLM_MANIFEST_PATH,
  LLAMACPP_RELEASE_VERSION
} from '@/constants'
import { CONFIG_MANAGER } from '@/config'
import { FileHelper } from '@/helpers/file-helper'
import { readLLMManifest, resolveConfiguredLLMTarget } from '@/core/llm-manager/llm-routing'
import { LLMProviders } from '@/core/llm-manager/types'

import inspectLocalAICapability from './local-ai-capability'
import { selectLocalLLM, isLocalLLMFileVerified, resolveLocalLLMInstallation } from './local-llm-selection'
import { createSetupStatus } from './setup-status'

const LLM_TARGET_KEYS = ['default', 'workflow', 'agent']

/**
 * Publish verified weights only after their replacement download completes.
 * Other profiles may still reference any previously installed model.
 */
export async function downloadLocalLLM(selected) {
  await fs.promises.mkdir(LLM_DIR_PATH, { recursive: true })
  const { targetPath, verified } = await resolveLocalLLMInstallation(selected)

  if (!verified) {
    const pendingPath = `${targetPath}.download`
    try {
      await FileHelper.downloadFile(selected.downloadURL, pendingPath, {
        skipExisting: false
      })
      if (!await isLocalLLMFileVerified(pendingPath, selected)) {
        throw new Error(`The downloaded ${selected.fileName} did not match its published checksum.`)
      }
      await fs.promises.rename(pendingPath, targetPath)
    } finally {
      await fs.promises.rm(pendingPath, { force: true })
    }
  }

  const metadata = {
    llamaCPPVersion: LLAMACPP_RELEASE_VERSION,
    defaultInstalledLLMPath: targetPath,
    repository: selected.repository,
    revision: selected.revision,
    sha256: selected.checksum,
    kvCacheType: selected.kvCacheType,
    ...(selected.contextPlan ? {
      contextWindowTokens: selected.contextPlan.contextTokens,
      estimatedMemoryMiB: selected.contextPlan.estimatedMiB,
      hostBudgetMiB: selected.contextPlan.hostBudgetMiB,
      memoryBudgetMiB: selected.contextPlan.memoryBudgetMiB
    } : {}),
    estimatedTPS: selected.estimatedTPS,
    plannerScore: selected.score
  }
  const manifestPath = `${targetPath}.manifest.json`
  await FileHelper.createManifestFile(`${manifestPath}.tmp`,
    selected.name, selected.precision, metadata)
  await fs.promises.rename(`${manifestPath}.tmp`, manifestPath)

  // Keep the legacy shared default stable for profiles still using a bare
  // provider name. Newly configured profiles pin their own selected filename.
  const previous = readLLMManifest(LLM_MANIFEST_PATH)
  if (selected.contextPlan &&
      (!previous?.defaultInstalledLLMPath || !fs.existsSync(previous.defaultInstalledLLMPath))) {
    await FileHelper.createManifestFile(`${LLM_MANIFEST_PATH}.tmp`,
      selected.name, selected.precision, metadata)
    await fs.promises.rename(`${LLM_MANIFEST_PATH}.tmp`, LLM_MANIFEST_PATH)
  }

  return targetPath
}

/**
 * Install a local model selected for this profile's currently available hardware.
 * Explicit owner choices and completed installations remain stable across setup.
 */
export default async function setupLocalLLM(localAICapability, setupState = {}) {
  const status = createSetupStatus('Checking local AI requirements...').start()

  try {
    const hardware = localAICapability || await inspectLocalAICapability()
    if (!hardware.canInstallLocalAI) {
      status.succeed('I will continue without a default local model because this computer does not meet the local AI hardware requirements.')
      return
    }

    const config = CONFIG_MANAGER.getConfig().llm
    const previous = readLLMManifest(LLM_MANIFEST_PATH)
    const targets = [config.workflow, config.agent, config.default].filter(Boolean)
    const explicitLocal = targets.some((value) => {
      const target = resolveConfiguredLLMTarget(value, {
        llmDirPath: LLM_DIR_PATH,
        defaultInstalledLLMPath: previous?.defaultInstalledLLMPath || ''
      })
      return target.isLocal && value !== target.provider
    })
    if (explicitLocal) {
      status.succeed('I will keep your configured local model.')
      return
    }

    let targetPath
    if (setupState.isInstalled && previous?.defaultInstalledLLMPath &&
        fs.existsSync(previous.defaultInstalledLLMPath)) {
      targetPath = previous.defaultInstalledLLMPath
    } else {
      const selected = await selectLocalLLM((message) => {
        status.text = message
      }, hardware)
      status.pause()
      const context = selected.contextPlan.contextTokens.toLocaleString('en-US')
      const memory = (selected.contextPlan.estimatedMiB / 1_024).toFixed(1)
      const budget = (selected.contextPlan.memoryBudgetMiB / 1_024).toFixed(1)
      console.info(`I selected ${selected.name} ${selected.precision}: ${context} tokens, estimated ${memory} GiB within a ${budget} GiB available-memory budget.`)
      targetPath = await downloadLocalLLM(selected)
      status.start()
    }

    const model = path.dirname(targetPath) === LLM_DIR_PATH ? path.basename(targetPath) : targetPath
    const bindDefault = LLM_TARGET_KEYS.every((key) => !config[key])
    for (const key of LLM_TARGET_KEYS) {
      if (config[key] === LLMProviders.LlamaCPP || (key === 'default' && bindDefault)) {
        await CONFIG_MANAGER.setValue(['llm', key], `${LLMProviders.LlamaCPP}/${model}`)
      }
    }
    status.succeed(`Local AI: ready — ${path.basename(targetPath)}`)
  } catch (error) {
    status.fail('I could not finish local AI setup.')
    throw error
  }
}
