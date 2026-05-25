import fs from 'node:fs'
import path from 'node:path'

import {
  LLM_MANIFEST_PATH,
  PYTORCH_MANIFEST_PATH,
  PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH,
  PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH,
  PYTHON_TCP_SERVER_TTS_MODEL_PATH
} from '@/constants'
import {
  ASR_MODEL_FILES,
  TTS_BERT_BASE_MODEL_FILES
} from '@/core/voice/voice-resource-state'

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

function hasManifest(manifestPath) {
  return readManifest(manifestPath) !== null
}

function hasAllFiles(directoryPath, fileNames) {
  return fileNames.every((fileName) =>
    fs.existsSync(path.join(directoryPath, fileName))
  )
}

/**
 * Inspect whether Leon's default local LLM has already been installed.
 */
export function inspectLocalAISetupState() {
  const manifest = readManifest(LLM_MANIFEST_PATH)
  const defaultInstalledLLMPath = manifest?.defaultInstalledLLMPath

  if (
    typeof defaultInstalledLLMPath !== 'string' ||
    defaultInstalledLLMPath.trim() === ''
  ) {
    return {
      isInstalled: false,
      label: ''
    }
  }

  const modelPath = path.resolve(defaultInstalledLLMPath)

  return {
    isInstalled: fs.existsSync(modelPath),
    label:
      manifest?.name && manifest?.version
        ? `${manifest.name} (${manifest.version})`
        : path.basename(modelPath)
  }
}

/**
 * Inspect whether voice mode has already been installed at least once.
 * Version-specific updates are handled by the voice setup pass.
 */
export function inspectVoiceSetupState() {
  const hasVoiceModels =
    hasAllFiles(
      PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH,
      TTS_BERT_BASE_MODEL_FILES
    ) &&
    fs.existsSync(PYTHON_TCP_SERVER_TTS_MODEL_PATH) &&
    hasAllFiles(PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH, ASR_MODEL_FILES)

  return {
    isInstalled: hasManifest(PYTORCH_MANIFEST_PATH) && hasVoiceModels
  }
}
