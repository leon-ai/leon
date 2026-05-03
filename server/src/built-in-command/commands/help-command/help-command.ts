import {
  BuiltInCommand,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'

export class HelpCommand extends BuiltInCommand {
  protected override description =
    'Display the supported built-in commands and usage.'
  protected override icon_name = 'ri-question-line'
  protected override supported_usages = ['/help']

  public constructor() {
    super('help')
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const items = context
      .resolveCommands()
      .sort((firstCommand, secondCommand) =>
        firstCommand.getName().localeCompare(secondCommand.getName())
      )
      .map((command) => ({
        label: command.getHelpUsage(),
        description: command.getDescription()
      }))

    return {
      status: 'completed',
      result: createListResult({
        title: 'Built-In Commands',
        tone: 'info',
        items
      })
    }
  }
}
