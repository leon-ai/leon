import {
  BuiltInCommand,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'

export class StopCommand extends BuiltInCommand {
  protected override description = 'Stop the current Leon server.'
  protected override icon_name = 'ri-stop-circle-line'
  protected override supported_usages = ['/stop', '/kill']
  protected override aliases = ['kill']

  public constructor() {
    super('stop')
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    void context

    // Give the response a brief moment to reach the client first.
    setTimeout(() => {
      process.kill(process.pid, 'SIGTERM')
    }, 250)

    return {
      status: 'completed',
      result: createListResult({
        title: 'Server Stopping',
        tone: 'info',
        items: [
          {
            label: 'Leon is stopping now.'
          }
        ]
      })
    }
  }
}
