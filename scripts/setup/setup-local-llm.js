import fs from 'node:fs'
import path from 'node:path'

import {
  LLM_DIR_PATH,
  LLM_MANIFEST_PATH,
  LLM_HIGH_TIER_MINIMUM_TOTAL_VRAM,
  LLM_MINIMUM_TOTAL_VRAM,
  LLAMACPP_RELEASE_VERSION
} from '@/constants'
import { FileHelper } from '@/helpers/file-helper'
import { NetworkHelper } from '@/helpers/network-helper'

import inspectLocalAICapability from './local-ai-capability'
import { createSetupStatus } from './setup-status'

/**
 * Download and set up the default local LLM
 * 1. Check minimum hardware requirements
 * 2. Select the default model according to total VRAM
 * 3. Download the model from Hugging Face or mirror
 * 4. Create manifest file with the default installed model path
 */

const DEFAULT_LLM_OPTIONS = [
  {
    minimumTotalVRAM: LLM_HIGH_TIER_MINIMUM_TOTAL_VRAM,
    name: 'Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive',
    version: 'Q4_K_M',
    fileName: 'Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',
    downloadURL:
      'https://huggingface.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive/resolve/main/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf?download=true'
  },
  {
    minimumTotalVRAM: LLM_MINIMUM_TOTAL_VRAM,
    name: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive',
    version: 'Q4_K_M',
    fileName: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',
    downloadURL:
      'https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive/resolve/main/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf?download=true'
  }
]
const LOCAL_AI_CHECK_TEXT = 'Checking local AI requirements...'

function readManifest() {
  if (!fs.existsSync(LLM_MANIFEST_PATH)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(LLM_MANIFEST_PATH, 'utf8'))
  } catch {
    return null
  }
}

function normalizeModelPath(modelPath) {
  return path.resolve(modelPath)
}

async function removePreviousDefaultModel(previousModelPath, nextModelPath) {
  if (!previousModelPath || previousModelPath === nextModelPath) {
    return
  }

  const resolvedPreviousModelPath = normalizeModelPath(previousModelPath)

  // Only delete the previous default model we installed under Leon's managed
  // shared models directory.
  if (!resolvedPreviousModelPath.startsWith(`${LLM_DIR_PATH}${path.sep}`)) {
    return
  }

  await fs.promises.rm(resolvedPreviousModelPath, { force: true })
}

function getSelectedModel(totalVRAM) {
  return (
    DEFAULT_LLM_OPTIONS.find(
      ({ minimumTotalVRAM }) => totalVRAM >= minimumTotalVRAM
    ) || null
  )
}

async function downloadLLM(selectedModel) {
  const manifest = readManifest()
  const targetPath = path.join(LLM_DIR_PATH, selectedModel.fileName)
  const defaultInstalledLLMPath = normalizeModelPath(targetPath)
  const isCurrentModelInstalled =
    manifest?.name === selectedModel.name &&
    manifest?.version === selectedModel.version &&
    manifest?.defaultInstalledLLMPath === defaultInstalledLLMPath &&
    fs.existsSync(targetPath)

  if (isCurrentModelInstalled) {
    return {
      installed: false,
      targetPath
    }
  }

  await fs.promises.mkdir(LLM_DIR_PATH, { recursive: true })
  await removePreviousDefaultModel(manifest?.defaultInstalledLLMPath, defaultInstalledLLMPath)
  await fs.promises.rm(targetPath, { force: true })

  const llmDownloadURL = await NetworkHelper.setHuggingFaceURL(
    selectedModel.downloadURL
  )

  await FileHelper.downloadFile(llmDownloadURL, targetPath)

  await FileHelper.createManifestFile(
    LLM_MANIFEST_PATH,
    selectedModel.name,
    selectedModel.version,
    {
      llamaCPPVersion: LLAMACPP_RELEASE_VERSION,
      defaultInstalledLLMPath
    }
  )

  return {
    installed: true,
    targetPath
  }
}

function getLocalAISummary(selectedModel, hardware) {
  const gpuLabel = hardware.hasGPU ? hardware.gpuDeviceNames[0] : 'CPU'
  const computeAPILabel = hardware.hasGPU
    ? String(hardware.graphicsComputeAPI).toUpperCase()
    : 'CPU'

  return `${selectedModel.name} (${selectedModel.version}, ${gpuLabel}, ${computeAPILabel}, ${hardware.totalVRAM} GB VRAM)`
}

export default async function setupLocalLLM(localAICapability) {
  const status = createSetupStatus(LOCAL_AI_CHECK_TEXT).start()

  const hardware = localAICapability || (await inspectLocalAICapability())

  if (!hardware.canInstallLocalAI) {
    status.succeed(
      `Local LLM support requires at least ${LLM_MINIMUM_TOTAL_VRAM} GB of total VRAM and a supported GPU setup. Current total VRAM is ${hardware.totalVRAM} GB. I will continue without installing a default local LLM.`
    )

    return
  }

  const selectedModel = getSelectedModel(hardware.totalVRAM)

  if (!selectedModel) {
    status.succeed(
      `No default local LLM matches the current total VRAM (${hardware.totalVRAM} GB).`
    )

    return
  }

  status.pause()

  const { installed } = await downloadLLM(selectedModel)
  status.text = 'Finalizing local AI...'
  status.start()

  if (installed) {
    status.succeed(
      `Local AI: ready - ${getLocalAISummary(selectedModel, hardware)}`
    )
  } else {
    status.succeed(
      `Local AI: ready - ${getLocalAISummary(selectedModel, hardware)}`
    )
  }
}
