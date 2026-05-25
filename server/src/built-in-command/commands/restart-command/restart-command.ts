import {
  BuiltInCommand,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import {
  LEON_RESTART_EXIT_CODE,
  requestShutdown
} from '@/core/server-lifecycle'

export class RestartCommand extends BuiltInCommand {
  protected override description = 'Restart the current Leon server.'
  protected override icon_name = 'ri-restart-line'
  protected override supported_usages = ['/restart']

  public constructor() {
    super('restart')
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    void context

    // Give the response a brief moment to reach the client first.
    setTimeout(() => {
      requestShutdown(LEON_RESTART_EXIT_CODE)
    }, 250)

    return {
      status: 'completed',
      result: createListResult({
        title: 'Server Restarting',
        tone: 'info',
        items: [
          {
            label: 'Leon is restarting now.'
          }
        ]
      })
    }
  }
}
