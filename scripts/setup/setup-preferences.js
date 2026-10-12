import { SetupUI, setupConsola } from './setup-ui'
import setupRemoteLLM from './setup-remote-llm'
import setupFellows from './setup-fellows'

/**
 * Ask lightweight setup questions so users can skip optional downloads.
 */
export default async function setupPreferences(
  localAICapability,
  existingLLMChoice,
  localAISetupState
  // voiceSetupState
) {
  const defaultPreferences = {
    setupLocalAI: false,
    setupVoice: false,
    remoteLLMProvider: '',
    remoteLLMModel: '',
    remoteLLMAPIKeyEnv: '',
    remoteLLMAPIKey: ''
  }

  if (
    process.env.IS_DOCKER === 'true' ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  ) {
    if (!localAICapability.canInstallLocalAI) {
      SetupUI.info(
        'This computer is not a good fit for local AI, so I will set up the essentials.'
      )
    }

    return defaultPreferences
  }

  const hasConfiguredLocalAI =
    existingLLMChoice.hasResolvedChoice &&
    existingLLMChoice.setupLocalAI &&
    existingLLMChoice.targetType !== 'defaultLocal'
  const hasInstalledLocalAI =
    localAISetupState.isInstalled || hasConfiguredLocalAI
  // const hasInstalledVoice = voiceSetupState.isInstalled
  const hasUsableExistingLLMChoice =
    existingLLMChoice.hasResolvedChoice &&
    (existingLLMChoice.targetType !== 'defaultLocal' || hasInstalledLocalAI)

  if (hasUsableExistingLLMChoice) {
    SetupUI.info(
      `I found your current AI setup, so I will keep using it: ${existingLLMChoice.label}`
    )
  }

  if (hasInstalledLocalAI) {
    SetupUI.info(
      `Local AI is already installed${
        localAISetupState.label ? `: ${localAISetupState.label}` : ''
      }`
    )
  }

  // Voice setup is paused; keep its flow here until it returns.
  // if (hasInstalledVoice) {
  //   SetupUI.info('Voice is already installed, so I will keep it updated.')
  // }

  if (!hasUsableExistingLLMChoice) {
    const fellowPreferences = await setupFellows()

    if (fellowPreferences) {
      return { ...defaultPreferences, ...fellowPreferences }
    }
  }

  if (!localAICapability.canInstallLocalAI) {
    if (!hasUsableExistingLLMChoice) {
      return {
        ...defaultPreferences,
        // setupVoice: hasInstalledVoice,
        ...(await setupRemoteLLM())
      }
    }

    return {
      ...defaultPreferences,
      setupLocalAI: hasInstalledLocalAI,
      // setupVoice: hasInstalledVoice
      setupVoice: false
    }
  }

  // if (!hasInstalledLocalAI || !hasInstalledVoice) {
  if (!hasInstalledLocalAI) {
    SetupUI.info(
      'I just have a few quick questions so I can set things up the way you want.'
    )
  }

  const setupLocalAI = hasInstalledLocalAI
    ? true
    : await setupConsola.prompt('Do you want me to set up local AI now?', {
        type: 'confirm',
        initial: false,
        cancel: 'default'
      })

  let remoteLLMPreferences = {
    remoteLLMProvider: '',
    remoteLLMModel: '',
    remoteLLMAPIKeyEnv: '',
    remoteLLMAPIKey: ''
  }

  if (!setupLocalAI && !hasUsableExistingLLMChoice) {
    remoteLLMPreferences = await setupRemoteLLM()
  }

  // const setupVoice = hasInstalledVoice
  //   ? true
  //   : await setupConsola.prompt('Do you want to talk to me with your voice now?', {
  //       type: 'confirm',
  //       initial: false,
  //       cancel: 'default'
  //     })

  const preferences = {
    ...defaultPreferences,
    setupLocalAI,
    // setupVoice,
    setupVoice: false,
    ...remoteLLMPreferences
  }

  return preferences
}
