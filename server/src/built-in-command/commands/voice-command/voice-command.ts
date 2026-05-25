import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult,
  type BuiltInCommandLoadingMessageContext,
  type BuiltInCommandRenderListItem
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { CONFIG_MANAGER } from '@/config'
import { TTSProviders } from '@/core/tts/types'
import { ASRProviders } from '@/core/asr/types'
import {
  areVoiceResourcesInstalled,
  getVoiceResourceState,
  type VoiceResourceState
} from '@/core/voice/voice-resource-state'
import { CODEBASE_PATH, PROFILE_CONFIG_PATH } from '@/leon-roots'

const VOICE_SETUP_SUB_COMMAND = 'setup'
const VOICE_STATUS_SUB_COMMAND = 'status'
const VOICE_ENABLE_SUB_COMMAND = 'enable'
const VOICE_DISABLE_SUB_COMMAND = 'disable'
const VOICE_SETUP_LOADING_MESSAGE =
  'Voice setup in progress... Check the terminal logs to review progress details.'
const RESTART_REQUIRED_MESSAGE =
  'Restart Leon by using /restart for voice runtime changes to take effect.'
const TSX_ENTRY_PATH = path.join(
  CODEBASE_PATH,
  'node_modules',
  'tsx',
  'dist',
  'cli.mjs'
)
const VOICE_SETUP_ENTRY_PATH = path.join(
  CODEBASE_PATH,
  'scripts',
  'setup',
  'setup-voice-resources.js'
)

const VOICE_SUB_COMMANDS = [
  VOICE_STATUS_SUB_COMMAND,
  VOICE_SETUP_SUB_COMMAND,
  VOICE_ENABLE_SUB_COMMAND,
  VOICE_DISABLE_SUB_COMMAND
] as const

const VOICE_FEATURES = [
  {
    name: 'asr',
    label: 'ASR',
    enabledKeyPath: ['voice', 'asr', 'enabled'],
    providerKeyPath: ['voice', 'asr', 'provider'],
    provider: ASRProviders.Local
  },
  {
    name: 'tts',
    label: 'TTS',
    enabledKeyPath: ['voice', 'tts', 'enabled'],
    providerKeyPath: ['voice', 'tts', 'provider'],
    provider: TTSProviders.Local
  },
  {
    name: 'wake-word',
    label: 'Wake word',
    enabledKeyPath: ['voice', 'wake_word_enabled']
  }
] as const

type VoiceSubCommand = (typeof VOICE_SUB_COMMANDS)[number]
type VoiceFeature = (typeof VOICE_FEATURES)[number]

function formatBoolean(value: boolean): string {
  return value ? 'enabled' : 'disabled'
}

function formatInstalled(value: boolean): string {
  return value ? 'ready' : 'missing'
}

function getVoiceFeature(featureName: string): VoiceFeature | null {
  return (
    VOICE_FEATURES.find((feature) => feature.name === featureName) || null
  )
}

export class VoiceCommand extends BuiltInCommand {
  protected override description =
    'Display, configure, or install local voice mode resources.'
  protected override icon_name = 'ri-mic-line'
  protected override supported_usages = [
    '/voice',
    '/voice status',
    '/voice setup',
    '/voice enable <voice_feature>',
    '/voice disable <voice_feature>'
  ]
  protected override help_usage = '/voice <status|setup|enable|disable>'

  public constructor() {
    super('voice')
  }

  public override getLoadingMessage(
    context: BuiltInCommandLoadingMessageContext
  ): string | null {
    return context.args[0]?.toLowerCase() === VOICE_SETUP_SUB_COMMAND
      ? VOICE_SETUP_LOADING_MESSAGE
      : null
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const subCommandArgument = context.args[0]?.toLowerCase() || ''
    const featureArgument = context.args[1]?.toLowerCase() || ''

    if (
      context.args.length === 0 ||
      (context.args.length === 1 && !context.ends_with_space)
    ) {
      return VOICE_SUB_COMMANDS.filter((subCommand) =>
        subCommand.startsWith(subCommandArgument)
      ).map((subCommand) => this.createSubCommandAutocompleteItem(subCommand))
    }

    if (
      subCommandArgument !== VOICE_ENABLE_SUB_COMMAND &&
      subCommandArgument !== VOICE_DISABLE_SUB_COMMAND
    ) {
      return []
    }

    return VOICE_FEATURES.filter((feature) =>
      feature.name.startsWith(featureArgument)
    ).map((feature) =>
      this.createFeatureAutocompleteItem(subCommandArgument, feature)
    )
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const subCommand = context.args[0]?.toLowerCase() || VOICE_STATUS_SUB_COMMAND

    if (subCommand === VOICE_STATUS_SUB_COMMAND) {
      return this.createStatusResult()
    }

    if (subCommand === VOICE_SETUP_SUB_COMMAND) {
      return this.setupVoice()
    }

    if (
      subCommand === VOICE_ENABLE_SUB_COMMAND ||
      subCommand === VOICE_DISABLE_SUB_COMMAND
    ) {
      return this.setFeatureState(subCommand, context.args[1]?.toLowerCase() || '')
    }

    return {
      status: 'error',
      result: createListResult({
        title: 'Unsupported Voice Command',
        tone: 'error',
        items: [
          {
            label: `The voice command "${subCommand}" is not supported.`,
            tone: 'error'
          },
          {
            label: 'Supported commands',
            value: VOICE_SUB_COMMANDS.join(', '),
            tone: 'error'
          }
        ]
      })
    }
  }

  private createSubCommandAutocompleteItem(
    subCommand: VoiceSubCommand
  ): BuiltInCommandAutocompleteItem {
    return {
      type: 'parameter',
      icon_name: this.getIconName(),
      name: subCommand,
      description: this.getSubCommandDescription(subCommand),
      usage: `/voice ${subCommand}`,
      supported_usages: this.getSupportedUsages(),
      value: `/voice ${subCommand}`
    }
  }

  private createFeatureAutocompleteItem(
    subCommand: string,
    feature: VoiceFeature
  ): BuiltInCommandAutocompleteItem {
    return {
      type: 'parameter',
      icon_name: this.getIconName(),
      name: feature.name,
      description: `${subCommand} ${feature.label}.`,
      usage: `/voice ${subCommand} ${feature.name}`,
      supported_usages: this.getSupportedUsages(),
      value: `/voice ${subCommand} ${feature.name}`
    }
  }

  private getSubCommandDescription(subCommand: VoiceSubCommand): string {
    if (subCommand === VOICE_SETUP_SUB_COMMAND) {
      return 'Install local voice resources and enable ASR/TTS.'
    }

    if (subCommand === VOICE_ENABLE_SUB_COMMAND) {
      return 'Enable a voice feature in the profile config.'
    }

    if (subCommand === VOICE_DISABLE_SUB_COMMAND) {
      return 'Disable a voice feature in the profile config.'
    }

    return 'Display voice configuration and resource status.'
  }

  private createStatusResult(): BuiltInCommandExecutionResult {
    const voiceConfig = CONFIG_MANAGER.getConfig().voice
    const resourceState = getVoiceResourceState()

    return {
      status: 'completed',
      result: createListResult({
        title: 'Voice Configuration',
        tone: 'info',
        items: [
          {
            label: 'ASR',
            value: `${formatBoolean(voiceConfig.asr.enabled)} (${voiceConfig.asr.provider})`
          },
          {
            label: 'TTS',
            value: `${formatBoolean(voiceConfig.tts.enabled)} (${voiceConfig.tts.provider})`
          },
          {
            label: 'Wake word',
            value: formatBoolean(voiceConfig.wake_word_enabled)
          },
          ...this.createResourceStatusItems(resourceState),
          {
            label: 'Profile config',
            value: PROFILE_CONFIG_PATH
          }
        ]
      })
    }
  }

  private async setupVoice(): Promise<BuiltInCommandExecutionResult> {
    try {
      await this.runVoiceResourceSetup()
    } catch (error) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Voice Setup Failed',
          tone: 'error',
          items: [
            {
              label:
                error instanceof Error ? error.message : String(error),
              tone: 'error'
            }
          ]
        })
      }
    }

    const resourceState = getVoiceResourceState()

    if (!areVoiceResourcesInstalled(resourceState)) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Voice Resources Missing',
          tone: 'error',
          items: this.createResourceStatusItems(resourceState, 'error')
        })
      }
    }

    await CONFIG_MANAGER.setValue(['voice', 'asr', 'enabled'], true)
    await CONFIG_MANAGER.setValue(['voice', 'asr', 'provider'], ASRProviders.Local)
    await CONFIG_MANAGER.setValue(['voice', 'tts', 'enabled'], true)
    await CONFIG_MANAGER.setValue(['voice', 'tts', 'provider'], TTSProviders.Local)

    return {
      status: 'completed',
      result: createListResult({
        title: 'Voice Setup Completed',
        tone: 'success',
        items: [
          {
            label: 'Local voice resources are ready.',
            tone: 'success'
          },
          {
            label: 'ASR and TTS are enabled with the local provider.',
            tone: 'success'
          },
          {
            label: RESTART_REQUIRED_MESSAGE,
            tone: 'warning'
          }
        ]
      })
    }
  }

  private async setFeatureState(
    subCommand: string,
    featureName: string
  ): Promise<BuiltInCommandExecutionResult> {
    const feature = getVoiceFeature(featureName)

    if (!feature) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Unsupported Voice Feature',
          tone: 'error',
          items: [
            {
              label: featureName
                ? `The voice feature "${featureName}" is not supported.`
                : 'Please provide a voice feature.',
              tone: 'error'
            },
            {
              label: 'Supported features',
              value: VOICE_FEATURES.map(({ name }) => name).join(', '),
              tone: 'error'
            }
          ]
        })
      }
    }

    const enabled = subCommand === VOICE_ENABLE_SUB_COMMAND

    await CONFIG_MANAGER.setValue([...feature.enabledKeyPath], enabled)

    if (enabled && 'providerKeyPath' in feature) {
      await CONFIG_MANAGER.setValue([...feature.providerKeyPath], feature.provider)
    }

    const items: BuiltInCommandRenderListItem[] = [
      {
        label: `${feature.label} is now ${formatBoolean(enabled)}.`,
        tone: 'success'
      },
      {
        label: RESTART_REQUIRED_MESSAGE,
        tone: 'warning'
      }
    ]

    if (enabled && !areVoiceResourcesInstalled()) {
      items.push({
        label: 'Voice resources are missing. Run /voice setup to install them.',
        tone: 'warning'
      })
    }

    return {
      status: 'completed',
      result: createListResult({
        title: 'Voice Configuration Updated',
        tone: 'success',
        items
      })
    }
  }

  private async runVoiceResourceSetup(): Promise<void> {
    if (!fs.existsSync(TSX_ENTRY_PATH)) {
      throw new Error('tsx is missing. Run pnpm install before running /voice setup.')
    }

    if (!fs.existsSync(VOICE_SETUP_ENTRY_PATH)) {
      throw new Error(`Voice setup entry not found at "${VOICE_SETUP_ENTRY_PATH}".`)
    }

    await execa(process.execPath, [TSX_ENTRY_PATH, VOICE_SETUP_ENTRY_PATH], {
      cwd: CODEBASE_PATH,
      env: {
        ...process.env,
        LEON_CODEBASE_PATH: CODEBASE_PATH
      },
      stdio: 'inherit'
    })
  }

  private createResourceStatusItems(
    resourceState: VoiceResourceState,
    tone?: BuiltInCommandRenderListItem['tone']
  ): BuiltInCommandRenderListItem[] {
    const createStatusItem = (
      label: string,
      isInstalled: boolean
    ): BuiltInCommandRenderListItem => ({
      label,
      value: formatInstalled(isInstalled),
      ...(tone ? { tone } : {})
    })

    return [
      createStatusItem('PyTorch', resourceState.pytorch),
      createStatusItem('ASR models', resourceState.asrModels),
      createStatusItem('TTS model', resourceState.ttsModel),
      createStatusItem('TTS language models', resourceState.ttsLanguageModels)
    ]
  }
}
