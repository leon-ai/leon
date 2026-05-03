import fs from 'node:fs'

import {
  CACHE_PATH,
  LEON_HOME_PATH,
  LEON_PROFILES_PATH,
  LEON_PROFILE_PATH,
  LEON_TOOLKITS_PATH,
  MODELS_PATH,
  PROFILE_CONTEXT_PATH,
  PROFILE_AGENT_SKILLS_PATH,
  PROFILE_LOGS_PATH,
  PROFILE_MEMORY_PATH,
  PROFILE_DISABLED_PATH,
  PROFILE_NATIVE_SKILLS_PATH,
  PROFILE_SKILLS_PATH,
  PROFILE_TOOLS_PATH,
  TMP_PATH,
  IS_GITHUB_ACTIONS
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { NetworkHelper } from '@/helpers/network-helper'

import buildApp from '../app/build-app'
import buildServer from '../build-server'
import train from '../train/train'
import generateHTTPAPIKey from '../generate/generate-http-api-key'
import generateJSONSchemas from '../generate/generate-json-schemas'

import setupDotenv, {
  readDotEnvVariables,
  updateDotEnvVariable
} from './setup-dotenv'
import setupCore from './setup-core'
import setupNode from './setup-node'
import setupPNPM from './setup-pnpm'
import setupNativeNodeModules from './setup-native-node-modules'
import setupPython from './setup-python'
import setupUV from './setup-uv'
import setupNodejsBridgeEnv from './setup-nodejs-bridge-env'
import setupPythonBridgeEnv from './setup-python-bridge-env'
import setupToolsDependencies from './setup-tools-dependencies'
import setupToolsSettings from './setup-tools-settings'
import setupSkills from './setup-skills/setup-skills'
import setupTCPServerEnv from './setup-tcp-server-env'
import setupCMake from './setup-cmake'
import setupNinja from './setup-ninja'
import setupLlamaCPP from './setup-llama-cpp'
import setupLocalLLM from './setup-local-llm'
import setupQMDLLM from './setup-qmd-llm'
import setupNVIDIALibs from './setup-nvidia-libs.js'
import setupPyTorch from './setup-pytorch.js'
import setupTCPServerModels from './setup-tcp-server-models'
import inspectLocalAICapability from './local-ai-capability'
import inspectVoiceSetupState from './inspect-voice-setup-state'
import postSetup from './post-setup'
import { printSetupBanner } from './setup-banner'
import { tellSetupCompletionJoke } from './setup-jokes'
import setupPreferences from './setup-preferences'
import { createSetupStatus } from './setup-status'
import { SetupUI } from './setup-ui'
import createInstanceID from './create-instance-id'
import setFfprobePermissions from './set-ffprobe-permissions'
import setupGitHooks from './setup-git-hooks'

const DISABLED_LLM_TARGET_VALUE = 'none'

/**
 * Create Leon home directories that setup and runtime expect to exist.
 */
async function ensureLeonHomeStructure() {
  const status = createSetupStatus('Preparing Leon home...').start()

  await Promise.all([
    fs.promises.mkdir(LEON_HOME_PATH, { recursive: true }),
    fs.promises.mkdir(LEON_PROFILES_PATH, { recursive: true }),
    fs.promises.mkdir(LEON_PROFILE_PATH, { recursive: true }),
    fs.promises.mkdir(CACHE_PATH, { recursive: true }),
    fs.promises.mkdir(LEON_TOOLKITS_PATH, { recursive: true }),
    fs.promises.mkdir(MODELS_PATH, { recursive: true }),
    fs.promises.mkdir(TMP_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_CONTEXT_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_MEMORY_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_LOGS_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_SKILLS_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_NATIVE_SKILLS_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_AGENT_SKILLS_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_TOOLS_PATH, { recursive: true })
  ])

  if (!fs.existsSync(PROFILE_DISABLED_PATH)) {
    await fs.promises.writeFile(
      PROFILE_DISABLED_PATH,
      JSON.stringify({ skills: [], tools: [] }, null, 2)
    )
  }

  status.succeed('Leon home: ready')
}

function isExplicitLocalLLMTarget(value) {
  const normalizedValue = (value || '').trim()

  return (
    normalizedValue.startsWith('llamacpp/') ||
    normalizedValue.startsWith('sglang/') ||
    normalizedValue.startsWith('/')
  )
}

async function resolveExistingLLMChoice() {
  const llmEnvValues = await readDotEnvVariables([
    'LEON_LLM',
    'LEON_WORKFLOW_LLM',
    'LEON_AGENT_LLM'
  ])
  const hasGlobalLLMSetting = Object.hasOwn(llmEnvValues, 'LEON_LLM')
  const leonLLM = (llmEnvValues['LEON_LLM'] || '').trim()
  const leonWorkflowLLM = (llmEnvValues['LEON_WORKFLOW_LLM'] || '').trim()
  const leonAgentLLM = (llmEnvValues['LEON_AGENT_LLM'] || '').trim()
  const overrideTargets = [leonWorkflowLLM, leonAgentLLM].filter(Boolean)

  if (overrideTargets.length > 0) {
    return {
      hasResolvedChoice: true,
      setupLocalAI: overrideTargets.some((target) =>
        isExplicitLocalLLMTarget(target)
      ),
      label: overrideTargets.join(', ')
    }
  }

  if (!hasGlobalLLMSetting || leonLLM === DISABLED_LLM_TARGET_VALUE) {
    return {
      hasResolvedChoice: false,
      setupLocalAI: false,
      label: ''
    }
  }

  return {
    hasResolvedChoice: true,
    setupLocalAI: leonLLM === '' || isExplicitLocalLLMTarget(leonLLM),
    label: leonLLM === '' ? 'Local AI' : leonLLM
  }
}

async function syncLLMSetupChoice(preferences) {
  const llmEnvValues = await readDotEnvVariables([
    'LEON_LLM',
    'LEON_WORKFLOW_LLM',
    'LEON_AGENT_LLM',
    preferences.remoteLLMAPIKeyEnv
  ])
  const leonLLM = (llmEnvValues['LEON_LLM'] || '').trim()
  const leonWorkflowLLM = (llmEnvValues['LEON_WORKFLOW_LLM'] || '').trim()
  const leonAgentLLM = (llmEnvValues['LEON_AGENT_LLM'] || '').trim()
  const hasExplicitModeOverride =
    leonWorkflowLLM !== '' || leonAgentLLM !== ''
  const hasExplicitGlobalTarget =
    leonLLM !== '' && leonLLM !== DISABLED_LLM_TARGET_VALUE

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
      await updateDotEnvVariable(
        'LEON_LLM',
        `${preferences.remoteLLMProvider}/${preferences.remoteLLMModel}`
      )
    }

    return
  }

  if (hasExplicitModeOverride || hasExplicitGlobalTarget) {
    return
  }

  if (preferences.setupLocalAI) {
    if (leonLLM === DISABLED_LLM_TARGET_VALUE) {
      await updateDotEnvVariable('LEON_LLM', '')
    }

    return
  }

  await updateDotEnvVariable('LEON_LLM', DISABLED_LLM_TARGET_VALUE)
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
  let voiceSetupState = {
    isReady: false
  }
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
    if (!IS_GITHUB_ACTIONS) {
      printSetupBanner()
    }

    // Ask setup questions first so the rest of the install can run unattended.
    if (!IS_GITHUB_ACTIONS) {
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
      currentStep = 'inspectVoiceSetupState'
      voiceSetupState = inspectVoiceSetupState()

      currentStep = 'setupPreferences'
      preferences = await setupPreferences(
        localAICapability,
        existingLLMChoice,
        voiceSetupState
      )
    }

    // Prepare the local runtime, bridges, skills, and shared memory models.
    SetupUI.section('Base Setup')

    currentStep = 'ensureLeonHomeStructure'
    await ensureLeonHomeStructure()
    currentStep = 'setupDotenv'
    await setupDotenv()
    currentStep = 'syncLLMSetupChoice'
    await syncLLMSetupChoice(preferences)
    currentStep = 'setupCore'
    await setupCore()
    if (!IS_GITHUB_ACTIONS) {
      currentStep = 'setupNode'
      await setupNode()
      currentStep = 'setupPNPM'
      await setupPNPM()
      currentStep = 'setupNativeNodeModules'
      await setupNativeNodeModules()
      currentStep = 'setupPython'
      await setupPython()
      currentStep = 'setupUV'
      await setupUV()
    } else {
      SetupUI.info(
        'Skipping portable Node.js, pnpm, Python and uv setup because it is running in CI'
      )
    }
    currentStep = 'setupNodejsBridgeEnv'
    await setupNodejsBridgeEnv()
    currentStep = 'setupPythonBridgeEnv'
    await setupPythonBridgeEnv()
    currentStep = 'setupTCPServerEnv'
    await setupTCPServerEnv()
    currentStep = 'setupToolsDependencies'
    await setupToolsDependencies()
    currentStep = 'setupToolsSettings'
    await setupToolsSettings()
    currentStep = 'setupSkills'
    await setupSkills()
    if (!IS_GITHUB_ACTIONS) {
      currentStep = 'setupQMDLLM'
      await setupQMDLLM()
    } else {
      SetupUI.info('Skipping QMD model setup because it is running in CI')
    }

    if (!IS_GITHUB_ACTIONS) {
      // Install local AI components based on the earlier capability check and answers.
      SetupUI.section('Local AI')

      if (preferences.setupLocalAI) {
        currentStep = 'setupCMake'
        await setupCMake()
        currentStep = 'setupNinja'
        await setupNinja()
        currentStep = 'setupLlamaCPP'
        await setupLlamaCPP()
        currentStep = 'setupLocalLLM'
        await setupLocalLLM(localAICapability)
      } else if (localAICapability?.canInstallLocalAI) {
        SetupUI.info('I will skip local AI for now. You can add it later.')
      } else {
        SetupUI.info('I will skip local AI because this computer does not support it.')
      }

      if (preferences.setupVoice) {
        currentStep = 'setupNVIDIALibs'
        await setupNVIDIALibs()
        currentStep = 'setupPyTorch'
        await setupPyTorch()
      } else {
        SetupUI.info('I will skip voice setup for now. You can add it later.')
      }
    } else {
      // Skip hardware-specific setup in CI where local AI and voice stacks are not needed.
      SetupUI.info(
        'Skipping CMake, Ninja, llama.cpp, local LLM, QMD models, NVIDIA, and PyTorch setups because it is running in CI'
      )
    }

    // Install voice models only when voice support is enabled.
    if (preferences.setupVoice) {
      currentStep = 'setupTCPServerModels'
      await setupTCPServerModels()
    } else {
      SetupUI.info('I will skip voice model downloads for now.')
    }

    // Finalize generated assets and instance-specific setup metadata.
    SetupUI.section('Finishing Up')

    currentStep = 'generateHTTPAPIKey'
    await generateHTTPAPIKey()
    currentStep = 'generateJSONSchemas'
    await generateJSONSchemas()
    currentStep = 'train'
    await train()
    currentStep = 'setFfprobePermissions'
    await setFfprobePermissions()
    currentStep = 'createInstanceID'
    await createInstanceID()
    currentStep = 'setupGitHooks'
    await setupGitHooks()
    currentStep = 'buildApp'
    {
      const status = createSetupStatus('Building app...').start()

      try {
        await buildApp({ quiet: true })
        status.succeed('App: ready')
      } catch (error) {
        status.fail('Failed to build app')
        throw error
      }
    }
    currentStep = 'buildServer'
    {
      const status = createSetupStatus('Building server...').start()

      try {
        await buildServer({ quiet: true })
        status.succeed('Server: ready')
      } catch (error) {
        status.fail('Failed to build server')
        throw error
      }
    }

    if (!IS_GITHUB_ACTIONS) {
      printSetupBanner()
    }

    SetupUI.recap([
      'Setup complete',
      `Local AI: ${preferences.setupLocalAI ? 'enabled' : 'skipped'}`,
      `Voice: ${preferences.setupVoice ? 'enabled' : 'skipped'}`
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
