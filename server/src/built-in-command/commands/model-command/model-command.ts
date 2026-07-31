import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult,
  type BuiltInCommandRenderListItem,
  type BuiltInCommandPendingInputExecutionContext
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import {
  getLLMModelCatalogEntries,
  type LLMModelReasoning,
  type LLMModelSpeed
} from '@/core/llm-manager/llm-model-catalog'
import { LLMProviders } from '@/core/llm-manager/types'
import { ProfileHelper } from '@/helpers/profile-helper'

const API_KEY_PARAMETER_NAME = 'api_key'
const API_KEY_INPUT_PLACEHOLDER = 'Paste API key here'
const API_KEY_INPUT_PROMPT_SUFFIX = 'API key:'
const CONFIGURED_TARGET_PARAMETER_NAME = 'configured_target'
const PROVIDER_PARAMETER_NAME = 'provider'
const API_KEY_ENV_PARAMETER_NAME = 'api_key_env'
const CREATE_API_KEY_LINK_LABEL = 'Create your API key here'
const REASONING_SUBCOMMAND = 'reasoning'
const SPEED_SUBCOMMAND = 'speed'
const MODEL_SETTING_SUBCOMMANDS = [
  REASONING_SUBCOMMAND,
  SPEED_SUBCOMMAND
] as const
const HIDDEN_MODEL_COMMAND_PROVIDERS = new Set<LLMProviders>([
  LLMProviders.SGLang
])

export class ModelCommand extends BuiltInCommand {
  protected override description =
    'Display or change the configured LLM model, reasoning, and speed.'
  protected override icon_name = 'ri-brain-line'
  protected override supported_usages = [
    '/model',
    '/model <provider> <model>',
    '/model reasoning [value]',
    '/model speed [value]'
  ]
  protected override help_usage = '/model <provider> <model>'
  protected override required_parameters = [
    {
      name: API_KEY_PARAMETER_NAME,
      questions: ['Please provide your API key:']
    }
  ]

  public constructor() {
    super('model')
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const modelState = CONFIG_STATE.getModelState()
    const providerArgument = context.args[0]?.toLowerCase() || ''
    const requestedModel = context.args.slice(1).join(' ').trim()

    if (providerArgument === REASONING_SUBCOMMAND) {
      return this.getModelSettingAutocompleteItems(
        REASONING_SUBCOMMAND,
        context.args[1] || ''
      )
    }

    if (providerArgument === SPEED_SUBCOMMAND) {
      return this.getModelSettingAutocompleteItems(
        SPEED_SUBCOMMAND,
        context.args[1] || ''
      )
    }

    if (
      context.args.length === 0 ||
      (context.args.length === 1 && !context.ends_with_space)
    ) {
      const subcommandItems = MODEL_SETTING_SUBCOMMANDS
        .filter((subcommand) => subcommand.startsWith(providerArgument))
        .map((subcommand): BuiltInCommandAutocompleteItem => ({
          type: 'parameter',
          icon_name: this.getIconName(),
          name: subcommand,
          description: `Configure the active model's ${subcommand}.`,
          usage: `/model ${subcommand} [value]`,
          supported_usages: this.getSupportedUsages(),
          value: `/model ${subcommand}`
        }))
      const providerItems = this.getVisibleSupportedProviders()
        .filter((provider) => provider.startsWith(providerArgument))
        .map((provider): BuiltInCommandAutocompleteItem => ({
          type: 'parameter',
          icon_name: this.getIconName(),
          name: provider,
          description: `Use "${provider}" as the LLM provider.`,
          usage: `/model ${provider} <model>`,
          supported_usages: this.getSupportedUsages(),
          value: `/model ${provider}`
        }))

      return [...subcommandItems, ...providerItems]
    }

    if (!modelState.isSupportedProvider(providerArgument)) {
      return []
    }

    const catalogEntries = getLLMModelCatalogEntries(providerArgument)
      .filter((entry) => {
        const normalizedCandidate = requestedModel.toLowerCase()

        return !normalizedCandidate ||
          entry.model.toLowerCase().startsWith(normalizedCandidate) ||
          entry.label.toLowerCase().startsWith(normalizedCandidate)
      })

    if (catalogEntries.length > 0) {
      return catalogEntries.map((entry) => ({
        type: 'parameter',
        icon_name: this.getIconName(),
        name: entry.label,
        description: `Set the ${providerArgument} model to "${entry.model}".`,
        usage: `/model ${providerArgument} ${entry.model}`,
        supported_usages: this.getSupportedUsages(),
        value: `/model ${providerArgument} ${entry.model}`
      }))
    }

    return requestedModel
      ? [{
          type: 'parameter',
          icon_name: this.getIconName(),
          name: requestedModel,
          description: `Set the ${providerArgument} model to "${requestedModel}".`,
          usage: `/model ${providerArgument} ${requestedModel}`,
          supported_usages: this.getSupportedUsages(),
          value: `/model ${providerArgument} ${requestedModel}`
        }]
      : []
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const modelState = CONFIG_STATE.getModelState()
    const visibleSupportedProviders = this.getVisibleSupportedProviders()
    const providerArgument = context.args[0]?.toLowerCase() || ''
    const requestedModel = context.args.slice(1).join(' ').trim()

    if (providerArgument === REASONING_SUBCOMMAND) {
      return this.executeModelSetting(
        REASONING_SUBCOMMAND,
        context.args[1]?.toLowerCase() || ''
      )
    }

    if (providerArgument === SPEED_SUBCOMMAND) {
      return this.executeModelSetting(
        SPEED_SUBCOMMAND,
        context.args[1]?.toLowerCase() || ''
      )
    }

    if (!providerArgument) {
      const agentTarget = modelState.getAgentTarget()
      const modelSettings = CONFIG_STATE
        .getModelSettingsState()
        .getSettings(agentTarget)

      return {
        status: 'completed',
        result: createListResult({
          title: 'Model Configuration',
          tone: 'info',
          items: [
            {
              label: 'Configured target',
              value: modelState.getConfiguredTargetDisplay()
            },
            {
              label: 'Workflow provider',
              value: modelState.getWorkflowTarget().provider || 'disabled'
            },
            {
              label: 'Workflow model',
              value: modelState.getWorkflowModelName()
            },
            {
              label: 'Agent provider',
              value: modelState.getAgentTarget().provider || 'disabled'
            },
            {
              label: 'Agent model',
              value: modelState.getAgentModelName()
            },
            {
              label: 'Agent reasoning',
              value: modelSettings.reasoning
            },
            {
              label: 'Agent speed',
              value: modelSettings.speed
            },
            {
              label: 'Supported providers',
              value: visibleSupportedProviders.join(', ')
            }
          ]
        })
      }
    }

    if (!modelState.isSupportedProvider(providerArgument)) {
      return this.createUnsupportedProviderResult(providerArgument)
    }

    if (!requestedModel) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Missing Model',
          tone: 'error',
          items: [
            {
              label: `The provider "${providerArgument}" requires a model value.`,
              tone: 'error'
            },
            {
              label: 'Usage',
              value: '/model <provider> <model>',
              tone: 'error'
            }
          ]
        })
      }
    }

    const provider = providerArgument as LLMProviders
    const providerLabel = modelState.getProviderLabel(provider)
    let configuredTarget = ''

    try {
      configuredTarget = modelState.createConfiguredTargetValue(
        provider,
        requestedModel
      )
    } catch (error) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Invalid Model Target',
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

    if (
      modelState.providerRequiresAPIKey(provider) &&
      !modelState.hasProviderAPIKey(provider)
    ) {
      const apiKeyEnv = modelState.getProviderAPIKeyEnv(provider)

      if (!apiKeyEnv) {
        throw new Error(`Missing API key env configuration for "${provider}".`)
      }

      return {
        status: 'awaiting_required_parameters',
        session: {
          required_parameters: [API_KEY_PARAMETER_NAME],
          collected_parameters: {
            [PROVIDER_PARAMETER_NAME]: provider,
            [CONFIGURED_TARGET_PARAMETER_NAME]: configuredTarget,
            [API_KEY_ENV_PARAMETER_NAME]: apiKeyEnv
          },
          pending_input: {
            name: API_KEY_PARAMETER_NAME,
            type: 'password',
            placeholder: API_KEY_INPUT_PLACEHOLDER,
            prompt: `Paste your ${providerLabel} ${API_KEY_INPUT_PROMPT_SUFFIX}`,
            icon_name: 'key-2',
            icon_type: 'fill'
          }
        },
        result: createListResult({
          title: 'API Key Required',
          tone: 'info',
          items: [
            this.createAPIKeyInstructionItem(provider),
            {
              label: 'Target',
              value: configuredTarget
            }
          ]
        })
      }
    }

    await modelState.setUnifiedTarget(configuredTarget)

    return this.createModelUpdatedResult(configuredTarget)
  }

  public override async executePendingInput(
    context: BuiltInCommandPendingInputExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const apiKey = context.input.trim()
    const provider = context.session.collected_parameters[PROVIDER_PARAMETER_NAME]
    const configuredTarget =
      context.session.collected_parameters[CONFIGURED_TARGET_PARAMETER_NAME]
    const apiKeyEnv =
      context.session.collected_parameters[API_KEY_ENV_PARAMETER_NAME]

    if (context.session.pending_input?.name !== API_KEY_PARAMETER_NAME) {
      throw new Error('This command is not waiting for an API key.')
    }

    if (!provider || !configuredTarget || !apiKeyEnv) {
      throw new Error('The model command session is missing configuration data.')
    }

    if (!apiKey) {
      return {
        status: 'awaiting_required_parameters',
        session: {
          pending_input: context.session.pending_input
        },
        result: createListResult({
          title: 'API Key Required',
          tone: 'error',
          items: [this.createInvalidAPIKeyItem(provider as LLMProviders)]
        })
      }
    }

    process.env[apiKeyEnv] = apiKey
    await ProfileHelper.updateDotEnvVariable(apiKeyEnv, apiKey)
    await CONFIG_STATE.getModelState().setUnifiedTarget(configuredTarget)

    return {
      status: 'completed',
      session: {
        required_parameters: [],
        collected_parameters: {},
        pending_input: null
      },
      result: this.createModelUpdatedResult(configuredTarget).result
    }
  }

  private createUnsupportedProviderResult(
    provider: string
  ): BuiltInCommandExecutionResult {
    const supportedProviders = this.getVisibleSupportedProviders()

    return {
      status: 'error',
      result: createListResult({
        title: 'Unsupported Provider',
        tone: 'error',
        items: [
          {
            label: `The provider "${provider}" is not supported.`,
            tone: 'error'
          },
          {
            label: 'Supported providers',
            value: supportedProviders.join(', '),
            tone: 'error'
          }
        ]
      })
    }
  }

  private getModelSettingAutocompleteItems(
    setting: typeof REASONING_SUBCOMMAND | typeof SPEED_SUBCOMMAND,
    requestedValue: string
  ): BuiltInCommandAutocompleteItem[] {
    const target = CONFIG_STATE.getModelState().getAgentTarget()
    const settingsState = CONFIG_STATE.getModelSettingsState()
    const normalizedRequestedValue = requestedValue.toLowerCase()
    const values = setting === REASONING_SUBCOMMAND
      ? settingsState.getAvailableReasoning(target)
      : settingsState.getAvailableSpeed(target)

    return values
      .filter((value) => value.startsWith(normalizedRequestedValue))
      .map((value) => ({
        type: 'parameter',
        icon_name: this.getIconName(),
        name: value,
        description: `Set ${target.label} ${setting} to "${value}".`,
        usage: `/model ${setting} ${value}`,
        supported_usages: this.getSupportedUsages(),
        value: `/model ${setting} ${value}`
      }))
  }

  private async executeModelSetting(
    setting: typeof REASONING_SUBCOMMAND | typeof SPEED_SUBCOMMAND,
    requestedValue: string
  ): Promise<BuiltInCommandExecutionResult> {
    const target = CONFIG_STATE.getModelState().getAgentTarget()
    const settingsState = CONFIG_STATE.getModelSettingsState()
    const currentSettings = settingsState.getSettings(target)
    const availableValues = setting === REASONING_SUBCOMMAND
      ? settingsState.getAvailableReasoning(target)
      : settingsState.getAvailableSpeed(target)

    if (!target.isEnabled || !target.isResolved) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Model Not Configured',
          tone: 'error',
          items: [{
            label: 'Configure an agent model before changing its settings.',
            tone: 'error'
          }]
        })
      }
    }

    if (!requestedValue) {
      return {
        status: 'completed',
        result: createListResult({
          title: `Model ${setting === REASONING_SUBCOMMAND ? 'Reasoning' : 'Speed'}`,
          tone: 'info',
          items: [
            { label: 'Model', value: target.label },
            { label: 'Current value', value: currentSettings[setting] },
            { label: 'Available values', value: availableValues.join(', ') }
          ]
        })
      }
    }

    try {
      if (setting === REASONING_SUBCOMMAND) {
        await settingsState.setReasoning(
          target,
          requestedValue as LLMModelReasoning
        )
      } else {
        await settingsState.setSpeed(target, requestedValue as LLMModelSpeed)
      }
    } catch (error) {
      return {
        status: 'error',
        result: createListResult({
          title: `Unsupported Model ${setting === REASONING_SUBCOMMAND ? 'Reasoning' : 'Speed'}`,
          tone: 'error',
          items: [
            {
              label: error instanceof Error ? error.message : String(error),
              tone: 'error'
            },
            {
              label: 'Available values',
              value: availableValues.join(', '),
              tone: 'error'
            }
          ]
        })
      }
    }

    return {
      status: 'completed',
      result: createListResult({
        title: `Model ${setting === REASONING_SUBCOMMAND ? 'Reasoning' : 'Speed'} Updated`,
        tone: 'success',
        items: [{
          label: `${target.label} ${setting} is now set to "${requestedValue}".`,
          tone: 'success'
        }]
      })
    }
  }

  private createModelUpdatedResult(
    configuredTarget: string
  ): BuiltInCommandExecutionResult {
    return {
      status: 'completed',
      result: createListResult({
        title: 'Model Updated',
        tone: 'success',
        items: [
          {
            label: `The configured model is now set to "${configuredTarget}".`,
            tone: 'success'
          }
        ]
      })
    }
  }

  private createAPIKeyInstructionItem(
    provider: LLMProviders
  ): BuiltInCommandRenderListItem {
    const modelState = CONFIG_STATE.getModelState()
    const apiKeyURL = CONFIG_STATE.getModelState().getProviderAPIKeyURL(provider)
    const providerLabel = modelState.getProviderLabel(provider)

    if (!apiKeyURL) {
      return {
        label: `Paste your ${providerLabel} API key in the input to finish configuring the model.`
      }
    }

    return {
      label: `Paste your ${providerLabel} API key in the input to finish configuring the model.`,
      inline_link_label: CREATE_API_KEY_LINK_LABEL,
      inline_link_href: apiKeyURL
    }
  }

  private createInvalidAPIKeyItem(
    provider: LLMProviders
  ): BuiltInCommandRenderListItem {
    const modelState = CONFIG_STATE.getModelState()
    const providerLabel = modelState.getProviderLabel(provider)
    const apiKeyURL = modelState.getProviderAPIKeyURL(provider)

    if (!apiKeyURL) {
      return {
        label: `Please paste a valid ${providerLabel} API key.`,
        tone: 'error'
      }
    }

    return {
      label: `Please paste a valid ${providerLabel} API key.`,
      inline_link_label: CREATE_API_KEY_LINK_LABEL,
      inline_link_href: apiKeyURL,
      tone: 'error'
    }
  }

  private getVisibleSupportedProviders(): LLMProviders[] {
    return CONFIG_STATE
      .getModelState()
      .getSupportedProviders()
      .filter((provider) => !HIDDEN_MODEL_COMMAND_PROVIDERS.has(provider))
  }
}
