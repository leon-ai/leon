import fs from 'node:fs'
import path from 'node:path'

import {
  PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH,
  PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH,
  PYTHON_TCP_SERVER_TTS_MODEL_PATH,
  PYTORCH_MANIFEST_PATH
} from '@/constants'

export const ASR_MODEL_FILES = [
  'model.bin',
  'config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'vocabulary.json'
] as const

export const TTS_BERT_BASE_MODEL_FILES = [
  'pytorch_model.bin',
  'config.json',
  'vocab.txt',
  'tokenizer_config.json',
  'tokenizer.json'
] as const

export interface VoiceResourceState {
  pytorch: boolean
  asrModels: boolean
  ttsModel: boolean
  ttsLanguageModels: boolean
}

function hasManifest(manifestPath: string): boolean {
  if (!fs.existsSync(manifestPath)) {
    return false
  }

  try {
    JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

    return true
  } catch {
    return false
  }
}

function hasAllFiles(directoryPath: string, fileNames: readonly string[]): boolean {
  return fileNames.every((fileName) =>
    fs.existsSync(path.join(directoryPath, fileName))
  )
}

export function getVoiceResourceState(): VoiceResourceState {
  return {
    pytorch: hasManifest(PYTORCH_MANIFEST_PATH),
    asrModels: hasAllFiles(
      PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH,
      ASR_MODEL_FILES
    ),
    ttsModel: fs.existsSync(PYTHON_TCP_SERVER_TTS_MODEL_PATH),
    ttsLanguageModels: hasAllFiles(
      PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH,
      TTS_BERT_BASE_MODEL_FILES
    )
  }
}

export function areVoiceResourcesInstalled(
  state = getVoiceResourceState()
): boolean {
  return (
    state.pytorch &&
    state.asrModels &&
    state.ttsModel &&
    state.ttsLanguageModels
  )
}
