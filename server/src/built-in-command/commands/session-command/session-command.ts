import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult,
  type BuiltInCommandRenderListItem
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { CONFIG_STATE } from '@/core/config-states/config-state'

const NEW_SUBCOMMAND = 'new'
const LIST_SUBCOMMAND = 'list'
const RENAME_SUBCOMMAND = 'rename'
const DELETE_SUBCOMMAND = 'delete'
const PIN_SUBCOMMAND = 'pin'
const UNPIN_SUBCOMMAND = 'unpin'
const MODEL_SUBCOMMAND = 'model'
const CLEAR_MODEL_SUBCOMMAND = 'clear-model'
const SESSION_SUBCOMMANDS = [
  NEW_SUBCOMMAND,
  LIST_SUBCOMMAND,
  RENAME_SUBCOMMAND,
  DELETE_SUBCOMMAND,
  PIN_SUBCOMMAND,
  UNPIN_SUBCOMMAND,
  MODEL_SUBCOMMAND,
  CLEAR_MODEL_SUBCOMMAND
]

export class SessionCommand extends BuiltInCommand {
  protected override description = 'Manage conversation sessions.'
  protected override icon_name = 'ri-chat-history-line'
  protected override supported_usages = [
    '/session',
    '/session new',
    '/session list',
    '/session rename <title>',
    '/session pin',
    '/session unpin',
    '/session delete',
    '/session model <provider> <model>',
    '/session clear-model'
  ]
  protected override help_usage = '/session <new|list|rename|pin|unpin|delete|model>'

  public constructor() {
    super('session')
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const subcommand = context.args[0]?.toLowerCase() || ''
    const modelState = CONFIG_STATE.getModelState()

    if (
      context.args.length === 0 ||
      (context.args.length === 1 && !context.ends_with_space)
    ) {
      return SESSION_SUBCOMMANDS
        .filter((item) => item.startsWith(subcommand))
        .map((item) => this.createSubcommandSuggestion(item))
    }

    if (subcommand !== MODEL_SUBCOMMAND) {
      return []
    }

    const providerArgument = context.args[1]?.toLowerCase() || ''
    const requestedModel = context.args.slice(2).join(' ').trim()

    if (
      context.args.length === 1 ||
      (context.args.length === 2 && !context.ends_with_space)
    ) {
      return modelState
        .getSupportedProviders()
        .filter((provider) => provider.startsWith(providerArgument))
        .map((provider) => ({
          type: 'parameter',
          icon_name: this.getIconName(),
          name: provider,
          description: `Use "${provider}" for this session.`,
          usage: `/session model ${provider} <model>`,
          supported_usages: this.getSupportedUsages(),
          value: `/session model ${provider}`
        }))
    }

    if (!modelState.isSupportedProvider(providerArgument)) {
      return []
    }

    return [
      {
        type: 'parameter',
        icon_name: this.getIconName(),
        name: requestedModel || providerArgument,
        description: requestedModel
          ? `Set this session model to "${requestedModel}".`
          : `Set this session ${providerArgument} model.`,
        usage: requestedModel
          ? `/session model ${providerArgument} ${requestedModel}`
          : `/session model ${providerArgument} <model>`,
        supported_usages: this.getSupportedUsages(),
        value: requestedModel
          ? `/session model ${providerArgument} ${requestedModel}`
          : `/session model ${providerArgument}`
      }
    ]
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const subcommand = context.args[0]?.toLowerCase() || ''
    const activeSessionId = CONVERSATION_SESSION_MANAGER.getCurrentSessionId()

    if (!subcommand) {
      return this.createSessionListResult('Current Session')
    }

    if (subcommand === NEW_SUBCOMMAND) {
      const session = CONVERSATION_SESSION_MANAGER.createSession()

      return {
        status: 'completed',
        result: createListResult({
          title: 'Session Created',
          tone: 'success',
          items: this.toSessionItems([session])
        })
      }
    }

    if (subcommand === LIST_SUBCOMMAND) {
      return this.createSessionListResult('Sessions')
    }

    if (subcommand === RENAME_SUBCOMMAND) {
      const title = context.args.slice(1).join(' ').trim()

      if (!title) {
        return this.createErrorResult('Missing Session Title')
      }

      const session = CONVERSATION_SESSION_MANAGER.updateSession(
        activeSessionId,
        { title }
      )

      return this.createUpdatedResult('Session Renamed', session)
    }

    if (subcommand === PIN_SUBCOMMAND || subcommand === UNPIN_SUBCOMMAND) {
      const session = CONVERSATION_SESSION_MANAGER.updateSession(
        activeSessionId,
        { isPinned: subcommand === PIN_SUBCOMMAND }
      )

      return this.createUpdatedResult('Session Updated', session)
    }

    if (subcommand === DELETE_SUBCOMMAND) {
      const session = CONVERSATION_SESSION_MANAGER.deleteSession(activeSessionId)

      return this.createUpdatedResult('Session Deleted', session)
    }

    if (subcommand === CLEAR_MODEL_SUBCOMMAND) {
      const session = CONVERSATION_SESSION_MANAGER.updateSession(
        activeSessionId,
        { modelTarget: null }
      )

      return this.createUpdatedResult('Session Model Cleared', session)
    }

    if (subcommand === MODEL_SUBCOMMAND) {
      const provider = context.args[1]?.toLowerCase() || ''
      const model = context.args.slice(2).join(' ').trim()

      if (!provider || !model) {
        return this.createErrorResult('Usage: /session model <provider> <model>')
      }

      try {
        const session =
          await CONVERSATION_SESSION_MANAGER.setSessionModelFromProvider(
            activeSessionId,
            provider,
            model
          )

        return this.createUpdatedResult('Session Model Updated', session)
      } catch (error) {
        return this.createErrorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    return this.createErrorResult(`Unknown session command "${subcommand}".`)
  }

  private createSubcommandSuggestion(
    subcommand: string
  ): BuiltInCommandAutocompleteItem {
    return {
      type: 'parameter',
      icon_name: this.getIconName(),
      name: subcommand,
      description: `Run /session ${subcommand}.`,
      usage: `/session ${subcommand}`,
      supported_usages: this.getSupportedUsages(),
      value: `/session ${subcommand}`
    }
  }

  private createSessionListResult(title: string): BuiltInCommandExecutionResult {
    return {
      status: 'completed',
      result: createListResult({
        title,
        tone: 'info',
        items: this.toSessionItems(CONVERSATION_SESSION_MANAGER.listSessions())
      })
    }
  }

  private createUpdatedResult(
    title: string,
    session: {
      title: string
      id: string
      isPinned: boolean
      modelTarget: string | null
    }
  ): BuiltInCommandExecutionResult {
    return {
      status: 'completed',
      result: createListResult({
        title,
        tone: 'success',
        items: this.toSessionItems([session])
      })
    }
  }

  private createErrorResult(title: string): BuiltInCommandExecutionResult {
    return {
      status: 'error',
      result: createListResult({
        title,
        tone: 'error',
        items: [
          {
            label: title,
            tone: 'error'
          }
        ]
      })
    }
  }

  private toSessionItems(
    sessions: Array<{
      title: string
      id: string
      isPinned: boolean
      modelTarget: string | null
    }>
  ): BuiltInCommandRenderListItem[] {
    const activeSessionId = CONVERSATION_SESSION_MANAGER.getCurrentSessionId()

    return sessions.map((session) => ({
      label: session.title,
      value: [
        session.id === activeSessionId ? 'active' : '',
        session.isPinned ? 'pinned' : '',
        session.modelTarget ? session.modelTarget : 'default model'
      ]
        .filter(Boolean)
        .join(', ')
    }))
  }
}
