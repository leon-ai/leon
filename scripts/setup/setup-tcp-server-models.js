import fs from 'node:fs'
import path from 'node:path'

import {
  PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH,
  // PYTHON_TCP_SERVER_TTS_BERT_FRENCH_DIR_PATH,
  // PYTHON_TCP_SERVER_TTS_BERT_FRENCH_MODEL_HF_PREFIX_DOWNLOAD_URL,
  PYTHON_TCP_SERVER_TTS_MODEL_PATH,
  PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH,
  PYTHON_TCP_SERVER_TTS_MODEL_HF_DOWNLOAD_URL,
  PYTHON_TCP_SERVER_ASR_MODEL_HF_PREFIX_DOWNLOAD_URL,
  PYTHON_TCP_SERVER_TTS_BERT_BASE_MODEL_HF_PREFIX_DOWNLOAD_URL
} from '@/constants'
import {
  ASR_MODEL_FILES,
  TTS_BERT_BASE_MODEL_FILES
} from '@/core/voice/voice-resource-state'
import { FileHelper } from '@/helpers/file-helper'
import { NetworkHelper } from '@/helpers/network-helper'

import { createSetupStatus } from './setup-status'

/*const TTS_BERT_FRENCH_MODEL_FILES = [
  'pytorch_model.bin', // Not needed? Compare with HF auto download in ~/.cache/huggingface/hub...
  'config.json',
  'vocab.txt',
  'tokenizer_config.json'
]*/

async function installTTSModel() {
  const destPath = PYTHON_TCP_SERVER_TTS_MODEL_PATH
  const pythonTCPServerTTSModelDownloadURL = await NetworkHelper.setHuggingFaceURL(
    PYTHON_TCP_SERVER_TTS_MODEL_HF_DOWNLOAD_URL
  )

  await FileHelper.downloadFile(pythonTCPServerTTSModelDownloadURL, destPath)
}
async function installASRModel() {
  for (const modelFile of ASR_MODEL_FILES) {
    const pythonTCPServerASRModelDownloadURL =
      await NetworkHelper.setHuggingFaceURL(
        PYTHON_TCP_SERVER_ASR_MODEL_HF_PREFIX_DOWNLOAD_URL
      )
    const modelInstallationFileURL = `${pythonTCPServerASRModelDownloadURL}/${modelFile}?download=true`
    const destPath = path.join(PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH, modelFile)

    await FileHelper.downloadFile(modelInstallationFileURL, destPath)
  }
}
/*async function installTTSBERTFrenchModel() {
  try {
    LogHelper.info('Installing TTS BERT French model...')

    for (const modelFile of TTS_BERT_FRENCH_MODEL_FILES) {
      const pythonTCPServerTTSBERTFrenchModelPrefixDownloadURL = await NetworkHelper.setHuggingFaceURL(
        PYTHON_TCP_SERVER_TTS_BERT_FRENCH_MODEL_HF_PREFIX_DOWNLOAD_URL
      )
      const modelInstallationFileURL = `${pythonTCPServerTTSBERTFrenchModelPrefixDownloadURL}/${modelFile}?download=true`
      const destPath = path.join(PYTHON_TCP_SERVER_TTS_BERT_FRENCH_DIR_PATH, modelFile)

      LogHelper.info(`Downloading ${modelFile}...`)

      await FileHelper.downloadFile(modelInstallationFileURL, destPath)

      LogHelper.success(`${modelFile} downloaded at ${destPath}`)
    }

    LogHelper.success('TTS BERT French model installed')
  } catch (e) {
    LogHelper.error(`Failed to install TTS BERT French model: ${e}`)
    process.exit(1)
  }
}*/
async function installTTSBERTBaseModel() {
  for (const modelFile of TTS_BERT_BASE_MODEL_FILES) {
    const pythonTCPServerTTSBERTBaseModelPrefixDownloadURL =
      await NetworkHelper.setHuggingFaceURL(
        PYTHON_TCP_SERVER_TTS_BERT_BASE_MODEL_HF_PREFIX_DOWNLOAD_URL
      )
    const modelInstallationFileURL = `${pythonTCPServerTTSBERTBaseModelPrefixDownloadURL}/${modelFile}?download=true`
    const destPath = path.join(PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH, modelFile)

    await FileHelper.downloadFile(modelInstallationFileURL, destPath)
  }
}

async function ensureModel({
  checkText,
  installText,
  successText,
  isInstalled,
  install
}) {
  const status = createSetupStatus(checkText).start()

  if (isInstalled()) {
    status.succeed(successText)
    return
  }

  status.pause()

  await install()

  status.text = installText
  status.start()

  status.succeed(successText)
}

export default async () => {
  await ensureModel({
    checkText: 'Checking voice language model files...',
    installText: 'Installing voice language model files...',
    successText: 'Voice language model files: ready',
    isInstalled: () =>
      fs.existsSync(
        path.join(
          PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH,
          TTS_BERT_BASE_MODEL_FILES[TTS_BERT_BASE_MODEL_FILES.length - 1]
        )
      ),
    install: installTTSBERTBaseModel
  })

  // TODO: later when multiple languages are supported
  /*LogHelper.info(
    'Checking whether TTS BERT French language model files are downloaded...'
  )
  const areTTSBERTFrenchFilesDownloaded = fs.existsSync(
    path.join(
      PYTHON_TCP_SERVER_TTS_BERT_FRENCH_DIR_PATH,
      TTS_BERT_FRENCH_MODEL_FILES[TTS_BERT_FRENCH_MODEL_FILES.length - 1]
    )
  )
  if (!areTTSBERTFrenchFilesDownloaded) {
    LogHelper.info('TTS BERT French language model files not downloaded')
    await installTTSBERTFrenchModel()
  } else {
    LogHelper.success(
      'TTS BERT French language model files are already downloaded'
    )
  }*/

  await ensureModel({
    checkText: 'Checking TTS model...',
    installText: 'Installing TTS model...',
    successText: 'TTS model: ready',
    isInstalled: () => fs.existsSync(PYTHON_TCP_SERVER_TTS_MODEL_PATH),
    install: installTTSModel
  })

  await ensureModel({
    checkText: 'Checking ASR model...',
    installText: 'Installing ASR model...',
    successText: 'ASR model: ready',
    isInstalled: () =>
      fs.existsSync(
        path.join(
          PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH,
          ASR_MODEL_FILES[ASR_MODEL_FILES.length - 1]
        )
      ),
    install: installASRModel
  })
}
