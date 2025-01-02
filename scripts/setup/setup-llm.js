import fs from 'node:fs'
import path from 'node:path'
import stream from 'node:stream'

import { command } from 'execa'

import {
  LLM_NAME,
  LLM_NAME_WITH_VERSION,
  LLM_MINIMUM_TOTAL_VRAM,
  LLM_DIR_PATH,
  LLM_PATH,
  LLM_VERSION,
  LLM_HF_DOWNLOAD_URL,
  LLM_LLAMA_CPP_RELEASE_TAG
} from '@/constants'
import { OSTypes, CPUArchitectures } from '@/types'
import { SystemHelper } from '@/helpers/system-helper'
import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'
import { NetworkHelper } from '@/helpers/network-helper'

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

async function checkMinimumHardwareRequirements() {
  LogHelper.info(
    'Checking minimum hardware requirements can take a few minutes...'
  )

  const { getLlama, LlamaLogLevel } = await Function(
    'return import("node-llama-cpp")'
  )()
  const llama = await getLlama({
    logLevel: LlamaLogLevel.disabled
  })

  if (!(await SystemHelper.hasGPU(llama))) {
    return false
  }

  LogHelper.info(
    `GPU detected: ${(await SystemHelper.getGPUDeviceNames(llama))[0]}`
  )
  LogHelper.info(
    `Graphics compute API: ${await SystemHelper.getGraphicsComputeAPI(llama)}`
  )
  LogHelper.info(`Total VRAM: ${await SystemHelper.getTotalVRAM(llama)} GB`)

  return (await SystemHelper.getTotalVRAM(llama)) >= LLM_MINIMUM_TOTAL_VRAM
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
      // Just in case the LLM file already exists, delete it first
      if (fs.existsSync(LLM_PATH)) {
        await fs.promises.unlink(LLM_PATH)
      }

      const llmDownloadURL =
        await NetworkHelper.setHuggingFaceURL(LLM_HF_DOWNLOAD_URL)

      LogHelper.info(
        `Downloading ${LLM_NAME_WITH_VERSION} from ${llmDownloadURL}...`
      )

      const llmWriter = fs.createWriteStream(LLM_PATH)
      const response = await FileHelper.downloadFile(llmDownloadURL, 'stream')

      response.data.pipe(llmWriter)
      await stream.promises.finished(llmWriter)

      await FileHelper.createManifestFile(
        LLM_MANIFEST_PATH,
        LLM_NAME,
        LLM_VERSION,
        {
          llamaCPPVersion: manifest?.llamaCPPVersion
            ? manifest.llamaCPPVersion
            : null
        }
      )
      LogHelper.success('Manifest file updated')

      LogHelper.success(`${LLM_NAME_WITH_VERSION} downloaded`)
      LogHelper.success(`${LLM_NAME_WITH_VERSION} ready`)
    } else {
      LogHelper.success(
        `${LLM_NAME_WITH_VERSION} is already set up and use the latest version`
      )
    }
  } catch (e) {
    LogHelper.error(`Failed to download LLM: ${e}`)
    process.exit(1)
  }
}

async function downloadAndCompileLlamaCPP() {
  const { type: osType, cpuArchitecture } = SystemHelper.getInformation()

  try {
    LogHelper.info(
      `Downloading and compiling "${LLM_LLAMA_CPP_RELEASE_TAG}" llama.cpp release...`
    )

    if (manifest?.llamaCPPVersion) {
      LogHelper.info(`Found llama.cpp ${manifest.llamaCPPVersion}`)
      LogHelper.info(`Latest version is ${LLM_LLAMA_CPP_RELEASE_TAG}`)
    }

    if (!manifest || manifest?.llamaCPPVersion !== LLM_LLAMA_CPP_RELEASE_TAG) {
      if (manifest?.llamaCPPVersion !== LLM_LLAMA_CPP_RELEASE_TAG) {
        LogHelper.info(`Updating llama.cpp to ${LLM_LLAMA_CPP_RELEASE_TAG}...`)
      }

      let llamaCPPDownloadCommand = `npx --no node-llama-cpp source download --release "${LLM_LLAMA_CPP_RELEASE_TAG}"`

      if (
        osType === OSTypes.MacOS &&
        cpuArchitecture === CPUArchitectures.X64
      ) {
        // llamaCPPDownloadCommand = `${llamaCPPDownloadCommand} --no-metal`

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
      LogHelper.success('Manifest file updated')

      LogHelper.success(`llama.cpp downloaded and compiled`)
      LogHelper.success('The LLM is ready to go')
    } else {
      LogHelper.success(
        `llama.cpp is already set up and use the latest version (${LLM_LLAMA_CPP_RELEASE_TAG})`
      )
    }
  } catch (e) {
    LogHelper.error(`Failed to set up llama.cpp: ${e}`)

    if (
      osType === OSTypes.MacOS &&
      cpuArchitecture === CPUArchitectures.ARM64
    ) {
      LogHelper.error(
        `Please verify that the Metal developer tools for macOS are installed.\n
        You can verify by running the following command in your terminal: xcode-select --install\n
        Otherwise download them here and retry: https://developer.apple.com/xcode/`
      )
    }

    process.exit(1)
  }
}

export default async () => {
  const canSetupLLM = await checkMinimumHardwareRequirements()

  if (!canSetupLLM) {
    const { getLlama, LlamaLogLevel } = await Function(
      'return import("node-llama-cpp")'
    )()
    const llama = await getLlama({
      logLevel: LlamaLogLevel.disabled
    })
    const totalVRAM = await SystemHelper.getTotalVRAM(llama)

    LogHelper.warning(
      `LLM requires at least ${LLM_MINIMUM_TOTAL_VRAM} GB of total VRAM. Current total VRAM is ${totalVRAM} GB. No worries though, Leon can still run without LLM.`
    )
  } else {
    await downloadLLM()
    await downloadAndCompileLlamaCPP()
  }
}
