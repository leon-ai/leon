import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns'
import stream from 'node:stream'

import { command } from 'execa'

import {
  LLM_NAME,
  LLM_NAME_WITH_VERSION,
  LLM_MINIMUM_TOTAL_RAM,
  LLM_DIR_PATH,
  LLM_PATH,
  LLM_VERSION,
  LLM_HF_DOWNLOAD_URL,
  LLM_MIRROR_DOWNLOAD_URL,
  LLM_LLAMA_CPP_RELEASE_TAG
} from '@/constants'
import { OSTypes, CPUArchitectures } from '@/types'
import { SystemHelper } from '@/helpers/system-helper'
import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'

/**
 * Download and set up LLM
 * 1. Check minimum hardware requirements
 * 2. Check if Hugging Face is accessible
 * 3. Download the latest LLM from Hugging Face or mirror
 * 4. Download and compile the latest llama.cpp release
 * 5. Create manifest file
 */

const LLM_MANIFEST_PATH = path.join(LLM_DIR_PATH, 'manifest.json')
let manifest = null

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

async function downloadLLM() {
  try {
    LogHelper.info('Downloading LLM...')

    if (fs.existsSync(LLM_MANIFEST_PATH)) {
      manifest = JSON.parse(
        await fs.promises.readFile(LLM_MANIFEST_PATH, 'utf8')
      )

      LogHelper.info(`Found ${LLM_NAME} ${manifest.version}`)
      LogHelper.info(`Latest version is ${LLM_VERSION}`)
    }

    if (!manifest || manifest.version !== LLM_VERSION) {
      const downloadURL = (await canAccessHuggingFace())
        ? LLM_HF_DOWNLOAD_URL
        : LLM_MIRROR_DOWNLOAD_URL

      // Just in case the LLM file already exists, delete it first
      if (fs.existsSync(LLM_PATH)) {
        await fs.promises.unlink(LLM_PATH)
      }

      LogHelper.info(
        `Downloading ${LLM_NAME_WITH_VERSION} from ${downloadURL}...`
      )

      const llmWriter = fs.createWriteStream(LLM_PATH)
      const response = await FileHelper.downloadFile(downloadURL, 'stream')

      response.data.pipe(llmWriter)
      await stream.promises.finished(llmWriter)

      LogHelper.success(`${LLM_NAME_WITH_VERSION} downloaded`)

      LogHelper.success(`${LLM_NAME_WITH_VERSION} ready`)
    } else {
      LogHelper.success(
        `${LLM_NAME_WITH_VERSION} is already set up and use the latest version`
      )
    }
  } catch (e) {
    LogHelper.error(`Failed to download LLM: ${e}`)
  }
}

async function downloadAndCompileLlamaCPP() {
  try {
    LogHelper.info(
      `Downloading and compiling "${LLM_LLAMA_CPP_RELEASE_TAG}" llama.cpp release...`
    )

    if (manifest.llamaCPPVersion) {
      LogHelper.info(`Found llama.cpp ${manifest.llamaCPPVersion}`)
      LogHelper.info(`Latest version is ${LLM_LLAMA_CPP_RELEASE_TAG}`)
    }

    if (!manifest || manifest.llamaCPPVersion !== LLM_LLAMA_CPP_RELEASE_TAG) {
      if (manifest.llamaCPPVersion !== LLM_LLAMA_CPP_RELEASE_TAG) {
        LogHelper.info(`Updating llama.cpp to ${LLM_LLAMA_CPP_RELEASE_TAG}...`)
      }

      const { type: osType, cpuArchitecture } = SystemHelper.getInformation()
      let llamaCPPDownloadCommand = `npx --no node-llama-cpp download --release "${LLM_LLAMA_CPP_RELEASE_TAG}"`

      if (
        osType === OSTypes.MacOS &&
        cpuArchitecture === CPUArchitectures.X64
      ) {
        llamaCPPDownloadCommand = `${llamaCPPDownloadCommand} --no-metal`

        LogHelper.info(`macOS Intel chipset detected, Metal support disabled`)
      }

      await command(llamaCPPDownloadCommand, {
        shell: true,
        stdio: 'inherit'
      })

      await FileHelper.createManifestFile(
        LLM_MANIFEST_PATH,
        LLM_NAME,
        LLM_VERSION,
        {
          llamaCPPVersion: LLM_LLAMA_CPP_RELEASE_TAG
        }
      )

      LogHelper.success('Manifest file created')
      LogHelper.success(`llama.cpp downloaded and compiled`)
      LogHelper.success('The LLM is ready to go')
    } else {
      LogHelper.success(
        `llama.cpp is already set up and use the latest version (${LLM_LLAMA_CPP_RELEASE_TAG})`
      )
    }
  } catch (e) {
    LogHelper.error(`Failed to set up llama.cpp: ${e}`)
  }
}

export default async () => {
  const canSetupLLM = checkMinimumHardwareRequirements()

  if (!canSetupLLM) {
    const totalRAM = SystemHelper.getTotalRAM()

    LogHelper.warning(
      `LLM requires at least ${LLM_MINIMUM_TOTAL_RAM} of total RAM. Current total RAM is ${totalRAM} GB. No worries though, Leon can still run without LLM.`
    )
  } else {
    await downloadLLM()
    await downloadAndCompileLlamaCPP()
  }
}
