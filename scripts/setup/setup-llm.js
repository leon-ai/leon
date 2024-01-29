import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns'
import stream from 'node:stream'

import {
  LLM_NAME,
  LLM_NAME_WITH_VERSION,
  LLM_MINIMUM_TOTAL_RAM,
  LLM_DIR_PATH,
  LLM_PATH,
  LLM_VERSION,
  LLM_HF_DOWNLOAD_URL,
  LLM_MIRROR_DOWNLOAD_URL
} from '@/constants'
import { SystemHelper } from '@/helpers/system-helper'
import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'

/**
 * Download and set up LLM
 * TODO...
 * Download LLM via Helper method...
 * Create manifest via Helper method...
 */

function checkMinimumHardwareRequirements() {
  return SystemHelper.getTotalRAM() >= LLM_MINIMUM_TOTAL_RAM
}

async function canAccessHuggingFace() {
  try {
    await dns.promises.resolve('huggingface.co')

    return true
  } catch {
    return false
  }
}

async function setupLLM() {
  try {
    LogHelper.info('Setting up LLM...')

    const llmManifestPath = path.join(LLM_DIR_PATH, 'manifest.json')
    let manifest = null

    if (fs.existsSync(llmManifestPath)) {
      manifest = JSON.parse(await fs.promises.readFile(llmManifestPath, 'utf8'))

      LogHelper.info(`Found ${LLM_NAME} ${manifest.version}`)
      LogHelper.info(`Latest version is ${LLM_VERSION}`)
    }

    if (!manifest || manifest.version !== LLM_VERSION) {
      const downloadURL = await canAccessHuggingFace() ? LLM_HF_DOWNLOAD_URL : LLM_MIRROR_DOWNLOAD_URL

      // Just in case the LLM file already exists, delete it first
      if (fs.existsSync(LLM_PATH)) {
        await fs.promises.unlink(LLM_PATH)
      }

      LogHelper.info(`Downloading ${LLM_NAME_WITH_VERSION} from ${downloadURL}...`)

      const llmWriter = fs.createWriteStream(LLM_PATH)
      const response = await FileHelper.downloadFile(downloadURL, 'stream')

      response.data.pipe(llmWriter)
      await stream.promises.finished(llmWriter)

      LogHelper.success(`${LLM_NAME_WITH_VERSION} downloaded`)

      await FileHelper.createManifestFile(llmManifestPath, LLM_NAME, LLM_VERSION)

      LogHelper.success('Manifest file created')
      LogHelper.success(`${LLM_NAME_WITH_VERSION} ready`)
    }

    LogHelper.success('LLM is set up')
  } catch (e) {
    LogHelper.error(`Failed to set up LLM: ${e}`)
  }
}

export default async () => {
  const canSetupLLM = checkMinimumHardwareRequirements()

  if (!canSetupLLM) {
    const totalRAM = SystemHelper.getTotalRAM()

    LogHelper.warning(`LLM requires at least ${LLM_MINIMUM_TOTAL_RAM} of total RAM. Current total RAM is ${totalRAM} GB. No worries though, Leon can still run without LLM.`)
  } else {
    await setupLLM()
  }
}
