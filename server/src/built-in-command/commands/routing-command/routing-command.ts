import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { CONFIG_STATE } from '@/core/config-states/config-state'

export class RoutingCommand extends BuiltInCommand {
  protected override description = 'Display or change the current routing mode.'
  protected override icon_name = 'ri-route-line'
  protected override supported_usages = ['/routing', '/routing <routing_mode>']
  protected override help_usage = '/routing <routing_mode>'

  public constructor() {
    super('routing')
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const routingModeState = CONFIG_STATE.getRoutingModeState()
    const currentArgument = context.args[0]?.toLowerCase() || ''

    return routingModeState
      .getSupportedRoutingModes()
      .filter((routingMode) => routingMode.startsWith(currentArgument))
      .map((routingMode) => ({
        type: 'parameter',
        icon_name: this.getIconName(),
        name: routingMode,
        description: `Set the routing mode to "${routingMode}".`,
        usage: `/routing ${routingMode}`,
        supported_usages: this.getSupportedUsages(),
        value: `/routing ${routingMode}`
      }))
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const routingModeState = CONFIG_STATE.getRoutingModeState()
    const requestedRoutingMode = context.args[0]?.toLowerCase()

    if (!requestedRoutingMode) {
      const currentRoutingMode = routingModeState.getRoutingMode()

      return {
        status: 'completed',
        result: createListResult({
          title: 'Routing Mode',
          tone: 'info',
          items: [
            {
              label: 'Current routing mode',
              value: currentRoutingMode
            },
            {
              label: 'Available routing modes',
              value: routingModeState.getSupportedRoutingModes().join(', ')
            }
          ]
        })
      }
    }

    const normalizedRoutingMode =
      routingModeState.getSupportedRoutingModes().find(
        (routingMode) => routingMode === requestedRoutingMode
      ) || null

    if (!normalizedRoutingMode) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Unsupported Routing Mode',
          tone: 'error',
          items: [
            {
              label: `The routing mode "${requestedRoutingMode}" is not supported.`,
              tone: 'error'
            },
            {
              label: 'Available routing modes',
              value: routingModeState.getSupportedRoutingModes().join(', '),
              tone: 'error'
            }
          ]
        })
      }
    }

    const nextRoutingMode = await routingModeState.setRoutingMode(
      normalizedRoutingMode
    )

    return {
      status: 'completed',
      result: createListResult({
        title: 'Routing Mode Updated',
        tone: 'success',
        items: [
          {
            label: `The routing mode is now set to "${nextRoutingMode}".`,
            tone: 'success'
          }
        ]
      })
    }
  }
}
