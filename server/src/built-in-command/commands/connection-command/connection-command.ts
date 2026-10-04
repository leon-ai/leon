import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult,
  type BuiltInCommandPendingInputExecutionContext
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { CONNECTION_STORE } from '@/core/connections/connection-store'
import { MODEL_ACCOUNT_STORE, useModelAccount } from '@/core/llm-manager/llm-accounts'
import { FellowAuthType } from '@/core/llm-manager/fellows/fellow-discovery'
import {
  executeAIConnectionCommand,
  AI_CONNECTION_PARAMETER_NAME,
  API_KEY_PARAMETER_NAME
} from './ai-connection-commands'

export const CONNECTION_COMMAND_NAME = 'connection'
export const AI_CONNECTION_SCOPE = 'ai'
export const AI_CONNECTION_MUTATION_ACTIONS = ['connect', 'use', 'disconnect'] as const

const AI_ACTIONS = [
  { name: 'discover', arguments: '', description: 'Find AI connections in my fellows.' },
  { name: 'connect', arguments: '<provider or connection>', description: 'Add or reconnect an AI connection.' },
  { name: 'use', arguments: '<connection>', description: 'Select a saved AI connection and its model.' },
  { name: 'disconnect', arguments: '<connection>', description: 'Remove my saved AI connection. Your fellow stays connected.' }
]

/**
 * List profile connections and manage AI connections through their existing store.
 */
export class ConnectionCommand extends BuiltInCommand {
  protected override description = 'List AI and tool connections, or manage AI connections.'
  protected override icon_name = 'ri-links-line'
  protected override supported_usages = [
    '/connection',
    '/connection ai',
    ...AI_ACTIONS.map((action) => `/connection ai ${action.name}${action.arguments ? ` ${action.arguments}` : ''}`)
  ]
  protected override help_usage = '/connection ai [discover|connect|use|disconnect]'

  public constructor() {
    super(CONNECTION_COMMAND_NAME)
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const scope = context.args[0]?.toLowerCase() || ''

    if (!context.args.length || (context.args.length === 1 && !context.ends_with_space)) {
      return AI_CONNECTION_SCOPE.startsWith(scope) ? [{
        type: 'parameter',
        icon_name: this.getIconName(),
        name: AI_CONNECTION_SCOPE,
        description: 'List or manage my AI connections.',
        usage: '/connection ai',
        supported_usages: this.getSupportedUsages(),
        value: '/connection ai'
      }] : []
    }

    if (scope !== AI_CONNECTION_SCOPE || context.args.length > 2) {
      return []
    }

    const requested = context.args[1]?.toLowerCase() || ''

    return AI_ACTIONS.filter((action) => action.name.startsWith(requested))
      .map((action) => ({
        type: 'parameter',
        icon_name: this.getIconName(),
        name: action.name,
        description: action.description,
        usage: `/connection ai ${action.name}${action.arguments ? ` ${action.arguments}` : ''}`,
        supported_usages: this.getSupportedUsages(),
        value: `/connection ai ${action.name}`
      }))
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    if (!context.args.length) {
      const [aiConnections, toolConnections] = await Promise.all([
        MODEL_ACCOUNT_STORE.list(),
        CONNECTION_STORE.list()
      ])
      const items = [
        ...aiConnections.map((connection) => ({
          label: `AI · ${connection.account_label || connection.provider}`,
          value: connection.status,
          description: `/connection ai use ${connection.provider}`
        })),
        ...toolConnections.map((connection) => ({
          label: `Tool · ${connection.account_label || connection.provider}`,
          value: `${connection.provider} · ${connection.status}`,
          description: 'Manage this connection using its tool connection card.'
        }))
      ]

      return {
        status: 'completed',
        result: createListResult({
          title: 'My connections',
          tone: 'info',
          items: items.length ? items : [{
            label: 'I have no saved connections yet.',
            description: 'Use /connection ai discover to find AI connections.'
          }]
        })
      }
    }

    const [rawScope, rawAction = '', ...values] = context.args
    const scope = rawScope?.toLowerCase()
    const action = rawAction.toLowerCase()
    const definition = AI_ACTIONS.find((candidate) => candidate.name === action)

    if (scope !== AI_CONNECTION_SCOPE || (action && !definition) ||
      (action === 'discover' && values.length)) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Connection command',
          tone: 'error',
          items: [{ label: `Use ${this.help_usage}. The discover action takes no value.` }]
        })
      }
    }

    return executeAIConnectionCommand(action, values.join(' ').trim())
  }

  public override async executePendingInput(
    context: BuiltInCommandPendingInputExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const id = context.session.collected_parameters[AI_CONNECTION_PARAMETER_NAME]
    const apiKey = context.input.trim()

    if (!id || context.session.pending_input?.name !== API_KEY_PARAMETER_NAME) {
      throw new Error('This command is not waiting for an AI connection API key.')
    }

    if (!apiKey) {
      return {
        status: 'awaiting_required_parameters',
        session: { pending_input: context.session.pending_input },
        result: createListResult({
          title: 'Replace my API key',
          tone: 'error',
          items: [{ label: 'Please paste your new API key.' }]
        })
      }
    }

    const account = (await MODEL_ACCOUNT_STORE.list()).find((saved) => saved.provider === id)
    const credentials = await MODEL_ACCOUNT_STORE.getCredentials(id, undefined, false, false)

    if (!account || credentials?.['auth_kind'] !== FellowAuthType.APIKey) {
      throw new Error('I could not find that API key connection. Use /connection ai.')
    }

    // Preserve this connection's model and endpoint when replacing its key.
    await MODEL_ACCOUNT_STORE.save({
      ...account,
      credentials: { ...credentials, api_key: apiKey }
    })
    await useModelAccount(id)

    return {
      status: 'completed',
      session: {
        required_parameters: [],
        collected_parameters: {},
        pending_input: null
      },
      result: createListResult({
        title: 'AI connection ready',
        tone: 'success',
        items: [{ label: 'I saved your new API key.', value: id }]
      })
    }
  }
}
