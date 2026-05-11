import type {
  BuiltInCommandAutocompleteContext,
  BuiltInCommandAutocompleteItem,
  BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { ProfileHelper } from '@/helpers/profile-helper'

import {
  createToolToggleSuccessResult,
  getSortedToolAutocompleteEntries,
  getToolSubcommandUsage,
  matchesRequestedTool,
  resolveToolEntry,
  TOOL_DISABLE_SUBCOMMAND,
  TOOL_ROOT_COMMAND_FORMAT,
  toToolSuggestion
} from '../tool-command-helpers'

import type {
  ToolSubCommand,
  ToolSubCommandExecutionContext
} from './tool-sub-command'

export class DisableToolSubCommand implements ToolSubCommand {
  public readonly name = TOOL_DISABLE_SUBCOMMAND
  public readonly description = 'Disable an enabled tool.'
  public readonly iconName = 'ri-checkbox-blank-circle-line'

  public getSuggestion(input: {
    commandPrefix: string
    supportedUsages: string[]
  }): BuiltInCommandAutocompleteItem {
    return {
      type: 'parameter',
      icon_name: this.iconName,
      name: this.name,
      description: this.description,
      usage: getToolSubcommandUsage(input.commandPrefix, this.name),
      supported_usages: input.supportedUsages,
      value: `${input.commandPrefix} ${this.name}`
    }
  }

  public getAutocompleteItems(input: {
    context: BuiltInCommandAutocompleteContext
    supportedUsages: string[]
  }): BuiltInCommandAutocompleteItem[] {
    const requestedToolName = input.context.args.slice(1).join(' ')

    return getSortedToolAutocompleteEntries()
      .filter((entry) => matchesRequestedTool(entry, requestedToolName))
      .map((entry) =>
        toToolSuggestion(
          entry,
          {
            commandPrefix: `${TOOL_ROOT_COMMAND_FORMAT} ${this.name}`,
            usage: `${TOOL_ROOT_COMMAND_FORMAT} ${this.name} ${entry.qualifiedName}`,
            value: `${TOOL_ROOT_COMMAND_FORMAT} ${this.name} ${entry.qualifiedName}`
          },
          input.supportedUsages
        )
      )
  }

  public async execute(
    context: ToolSubCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const toolEntry = resolveToolEntry(context.rawToolName)

    if (!context.rawToolName.trim()) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Missing Tool Name',
          tone: 'error',
          items: [
            {
              label: `Usage: ${TOOL_ROOT_COMMAND_FORMAT} ${this.name} <toolkit>.<tool_name>`,
              tone: 'error'
            }
          ]
        })
      }
    }

    if (!toolEntry) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Unknown Tool',
          tone: 'error',
          items: [
            {
              label: `The tool "${context.rawToolName.trim()}" is not available for this operation.`,
              tone: 'error'
            }
          ]
        })
      }
    }

    await ProfileHelper.disableTool(toolEntry.qualifiedName)

    return createToolToggleSuccessResult('disabled', toolEntry)
  }
}
