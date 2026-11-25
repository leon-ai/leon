import {
  LLM_DIR_PATH,
  LLM_MANIFEST_PATH,
  IS_CI
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { NetworkHelper } from '@/helpers/network-helper'
import { readLLMManifest, resolveConfiguredLLMTarget } from '@/core/llm-manager/llm-routing'

import buildApp from '../app/build-app'
import buildServer from '../build-server'
import train from '../train/train'
import generateJSONSchemas from '../generate/generate-json-schemas'

import { updateDotEnvVariable } from './setup-dotenv'
import { CONFIG_MANAGER } from '@/config'
import setupServerConfig from './setup-core'
import { setupProfile } from './setup-profile'
import { shouldUseCIRuntimes } from './setup-ci.js'
import setupNode from './setup-node'
import setupPNPM from './setup-pnpm'
import setupPython from './setup-python'
import setupUV from './setup-uv'
import setupJQ from './setup-jq'
import setupNodejsBridgeEnv from './setup-nodejs-bridge-env'
import setupToolsDependencies from './setup-tools-dependencies'
import setupTCPServerEnv from './setup-tcp-server-env'
import setupCMake from './setup-cmake'
import setupNinja from './setup-ninja'
import setupLlamaCPP from './setup-llama-cpp'
import setupLLMFit from './setup-llmfit'
import setupLocalLLM from './setup-local-llm'
import setupQMDLLM from './setup-qmd-llm'
// import setupVoiceResources from './setup-voice-resources.js'
import inspectLocalAICapability from './local-ai-capability'
import {
  inspectLocalAISetupState
  // inspectVoiceSetupState
} from './inspect-setup-state'
import postSetup from './post-setup'
import { printSetupBanner } from './setup-banner'
import { tellSetupCompletionJoke } from './setup-jokes'
import setupPreferences from './setup-preferences'
import { createSetupStatus } from './setup-status'
import { SetupUI } from './setup-ui'
import setFfprobePermissions from './set-ffprobe-permissions'
import setupGitHooks from './setup-git-hooks'

const USE_CI_RUNTIMES = shouldUseCIRuntimes()

function isExplicitLocalLLMTarget(value) {
  const normalizedValue = (value || '').trim()
  return resolveConfiguredLLMTarget(normalizedValue, {
    llmDirPath: LLM_DIR_PATH,
    defaultInstalledLLMPath: readLLMManifest(LLM_MANIFEST_PATH)?.defaultInstalledLLMPath || ''
  }).isLocal
}

function getOptionalLLMTarget(value) {
  return typeof value === 'string' ? value.trim() : ''
}

async function resolveExistingLLMChoice() {
  const llmConfig = CONFIG_MANAGER.getConfig().llm
  const leonLLM = getOptionalLLMTarget(llmConfig.default)
  const leonWorkflowLLM = getOptionalLLMTarget(llmConfig.workflow)
  const leonAgentLLM = getOptionalLLMTarget(llmConfig.agent)
  const overrideTargets = [leonWorkflowLLM, leonAgentLLM].filter(Boolean)

  if (overrideTargets.length > 0) {
    return {
      hasResolvedChoice: true,
      setupLocalAI: overrideTargets.some((target) =>
        isExplicitLocalLLMTarget(target)
      ),
      targetType: overrideTargets.some((target) =>
        isExplicitLocalLLMTarget(target)
      )
        ? 'explicitLocal'
        : 'remote',
      label: overrideTargets.join(', ')
    }
  }

  if (leonLLM === '') {
    return {
      hasResolvedChoice: false,
      setupLocalAI: false,
      targetType: 'disabled',
      label: ''
    }
  }

  return {
    hasResolvedChoice: true,
    setupLocalAI: isExplicitLocalLLMTarget(leonLLM),
    targetType: isExplicitLocalLLMTarget(leonLLM)
      ? 'explicitLocal'
      : 'remote',
    label: leonLLM
  }
}

async function syncLLMSetupChoice(preferences) {
  CONFIG_MANAGER.reload()
  if (preferences.fellowAccount) {
    return
  }
  const llmConfig = CONFIG_MANAGER.getConfig().llm
  const leonLLM = getOptionalLLMTarget(llmConfig.default)
  const leonWorkflowLLM = getOptionalLLMTarget(llmConfig.workflow)
  const leonAgentLLM = getOptionalLLMTarget(llmConfig.agent)
  const hasExplicitModeOverride =
    leonWorkflowLLM !== '' || leonAgentLLM !== ''
  const hasExplicitGlobalTarget =
    leonLLM !== ''

  if (
    preferences.remoteLLMProvider &&
    preferences.remoteLLMModel &&
    preferences.remoteLLMAPIKeyEnv &&
    preferences.remoteLLMAPIKey
  ) {
    await updateDotEnvVariable(
      preferences.remoteLLMAPIKeyEnv,
      preferences.remoteLLMAPIKey.trim()
    )

    if (!hasExplicitModeOverride) {
      await CONFIG_MANAGER.setValue(
        ['llm', 'default'],
        `${preferences.remoteLLMProvider}/${preferences.remoteLLMModel}`
      )
    }

    return
  }

  if (hasExplicitModeOverride || hasExplicitGlobalTarget) {
    return
  }

  if (preferences.setupLocalAI) {
    // Bind the profile only after its selected model is verified. An unfinished
    // setup must not inherit another profile's shared legacy default.
    return
  }

  await CONFIG_MANAGER.setValue(['llm', 'default'], null)
}
// Do not load ".env" file because it is not created yet

/**
 * Main entry to set up Leon
 */
;(async () => {
  // Track setup execution state for user-facing error reporting and interruption handling.
  let currentStep = 'bootstrap'
  let shutdownSignal = null
  let preferences = {
    setupLocalAI: false,
    setupVoice: false
  }
  let localAICapability = null
  let localAISetupState = {
    isInstalled: false,
    label: ''
  }
  // let voiceSetupState = {
  //   isInstalled: false
  // }
  const getExitCodeFromSignal = (signal) => (signal === 'SIGINT' ? 130 : 143)

  // Clean up process signal listeners when setup exits normally or with an error.
  const cleanupSignalHandlers = () => {
    process.off('SIGINT', handleShutdownSignal)
    process.off('SIGTERM', handleShutdownSignal)
  }

  // Abort active downloads and exit cleanly when setup is interrupted.
  const handleShutdownSignal = (signal) => {
    if (shutdownSignal) {
      process.exit(getExitCodeFromSignal(signal))
    }

    shutdownSignal = signal

    const abortedDownloadCount = NetworkHelper.abortActiveDownloads(
      `Setup interrupted by ${signal}`
    )

    if (abortedDownloadCount === 0) {
      process.exit(getExitCodeFromSignal(signal))
    }
  }

  process.on('SIGINT', handleShutdownSignal)
  process.on('SIGTERM', handleShutdownSignal)

  try {
    // Print the setup banner outside CI so the local install feels branded.
    if (!IS_CI) {
      printSetupBanner()
    }

    // Ask setup questions first so the rest of the install can run unattended.
    if (!USE_CI_RUNTIMES) {
      SetupUI.section('Quick Setup')

      currentStep = 'inspectLocalAICapability'
      const capabilityStatus = createSetupStatus(
        'Checking what this computer can handle...'
      ).start()
      localAICapability = await inspectLocalAICapability()

      if (localAICapability.canInstallLocalAI) {
        capabilityStatus.succeed(
          'Local AI supported: better privacy and less to configure online'
        )
      } else {
        capabilityStatus.stop()
        SetupUI.info('Local AI is not supported on this computer')
      }

      currentStep = 'resolveExistingLLMChoice'
      const existingLLMChoice = await resolveExistingLLMChoice()
      currentStep = 'inspectLocalAISetupState'
      // Shared cached weights do not opt a new profile into local AI.
      localAISetupState = existingLLMChoice.setupLocalAI
        ? inspectLocalAISetupState()
        : localAISetupState
      // currentStep = 'inspectVoiceSetupState'
      // voiceSetupState = inspectVoiceSetupState()

      currentStep = 'setupPreferences'
      preferences = await setupPreferences(
        localAICapability,
        existingLLMChoice,
        localAISetupState
        // voiceSetupState
      )
    }

    // Prepare the local runtime, bridges, skills, and shared memory models.
    SetupUI.section('Base Setup')

    currentStep = 'generateJSONSchemas'
    await generateJSONSchemas()
    await setupProfile({
      onStep(name) {
        currentStep = name
      },
      async prepareRuntime() {
        currentStep = 'syncLLMSetupChoice'
        await syncLLMSetupChoice(preferences)
        currentStep = 'setupServerConfig'
        await setupServerConfig()
        if (!USE_CI_RUNTIMES) {
          currentStep = 'setupNode'
          await setupNode()
          currentStep = 'setupPNPM'
          await setupPNPM()
          currentStep = 'setupPython'
          await setupPython()
          currentStep = 'setupUV'
          await setupUV()
        } else {
          SetupUI.info(
            'Skipping portable Node.js, pnpm, Python and uv setup because CI supplies verification runtimes'
          )
        }

        // The server queries retained results even in CI, where portable runtimes are skipped.
        currentStep = 'setupJQ'
        await setupJQ()
        currentStep = 'setupNodejsBridgeEnv'
        await setupNodejsBridgeEnv()
        if (!USE_CI_RUNTIMES) {
          currentStep = 'setupTCPServerEnv'
          await setupTCPServerEnv()
        } else {
          SetupUI.info('Skipping Python TCP server setup because CI supplies verification runtimes')
        }
      },
      async prepareTools() {
        currentStep = 'setupToolsDependencies'
        await setupToolsDependencies()
      }
    })
    // CI installation checks do not need optional local memory models.
    if (!IS_CI) {
      currentStep = 'setupQMDLLM'
      await setupQMDLLM()
    } else {
      SetupUI.info('Skipping QMD model setup because it is running in CI')
    }

    if (!USE_CI_RUNTIMES) {
      // Install local AI components based on the earlier capability check and answers.
      SetupUI.section('Local AI')

      if (preferences.setupLocalAI) {
        currentStep = 'setupCMake'
        await setupCMake()
        currentStep = 'setupNinja'
        await setupNinja()
        currentStep = 'setupLlamaCPP'
        await setupLlamaCPP(localAICapability)
        currentStep = 'setupLLMFit'
        await setupLLMFit()
        currentStep = 'setupLocalLLM'
        await setupLocalLLM(localAICapability, localAISetupState)
      } else if (localAICapability?.canInstallLocalAI) {
        SetupUI.info('I will skip local AI for now. You can add it later.')
      } else {
        SetupUI.info('I will skip local AI because this computer does not support it.')
      }

      // Voice setup is paused; retain the installation flow for its return.
      // if (preferences.setupVoice) {
      //   currentStep = 'setupVoiceResources'
      //   await setupVoiceResources()
      // } else {
      //   SetupUI.info('I will skip voice setup for now. You can add it later.')
      // }
    } else {
      // Skip hardware-specific setup in CI where local AI and voice stacks are not needed.
      SetupUI.info(
        'Skipping CMake, Ninja, llama.cpp, local LLM, QMD models, NVIDIA, and PyTorch setups because it is running in CI'
      )
    }

    // if (!preferences.setupVoice) {
    //   SetupUI.info('I will skip voice model downloads for now.')
    // }

    // Finalize generated assets and instance-specific setup metadata.
    SetupUI.section('Finishing Up')

    currentStep = 'train'
    await train()
    currentStep = 'setFfprobePermissions'
    await setFfprobePermissions()
    currentStep = 'setupGitHooks'
    await setupGitHooks()
    currentStep = 'buildApp'
    {
      const status = createSetupStatus('Building apps...').start()

      try {
        await buildApp({ quiet: true })
        await buildApp({ quiet: true, configFile: 'apps/web/vite.config.ts' })
        status.succeed('Apps: ready')
      } catch (error) {
        status.fail('Failed to build apps')
        throw error
      }
    }
    currentStep = 'buildServer'
    {
      const status = createSetupStatus('Building the server...').start()

      try {
        await buildServer({ quiet: true })
        status.succeed('Server: ready')
      } catch (error) {
        status.fail('Failed to build the server')
        throw error
      }
    }

    if (!IS_CI) {
      printSetupBanner()
    }

    SetupUI.recap([
      'Setup complete',
      `Local AI: ${preferences.setupLocalAI ? 'enabled' : 'skipped'}`
      // `Voice: ${preferences.setupVoice ? 'enabled' : 'skipped'}`
    ])
    tellSetupCompletionJoke()
    console.log('')
    SetupUI.successHighlight('Hooray! I\'m installed and ready to go!')
    console.log('')
    SetupUI.bullet(
      `Follow my creator to get regular updates about me: ${SetupUI.underlined(
        'https://x.com/grenlouis'
      )}`
    )
    console.log('')
    currentStep = 'postSetup'
    await postSetup()
  } catch (e) {
    // Exit with the original signal code when setup was intentionally interrupted.
    if (shutdownSignal) {
      cleanupSignalHandlers()
      process.exit(getExitCodeFromSignal(shutdownSignal))
    }

    // Surface the failing phase clearly when setup stops on an unexpected error.
    LogHelper.error(
      `Setup failed during ${currentStep}: ${
        e instanceof Error ? e.stack || e.message : String(e)
      }`
    )
    cleanupSignalHandlers()
    process.exit(1)
  }
})()
