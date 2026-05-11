import type {
  BuiltInCommandAutocompleteContext,
  BuiltInCommandAutocompleteItem,
  BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'

import {
  getSortedToolAutocompleteEntries,
  getToolSubcommandUsage,
  TOOL_LIST_SUBCOMMAND
} from '../tool-command-helpers'

import type {
  ToolSubCommand,
  ToolSubCommandExecutionContext
} from './tool-sub-command'

export class ListToolSubCommand implements ToolSubCommand {
  public readonly name = TOOL_LIST_SUBCOMMAND
  public readonly description = 'List all installed tools.'
  public readonly iconName = 'ri-list-check-3'

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
    void input

    return []
  }

  public async execute(
    context: ToolSubCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    void context

    const toolItems = getSortedToolAutocompleteEntries({
      includeDisabled: true
    }).map((entry) => {
      return {
        label: entry.qualifiedName,
        value: `toolkit=${entry.toolkitName}, status=${
          entry.isDisabled ? 'disabled' : 'enabled'
        }`,
        description: entry.description,
        tone: entry.isDisabled ? 'warning' as const : 'default' as const
      }
    })

    return {
      status: 'completed',
      result: createListResult({
        title: 'Tools',
        tone: 'info',
        header: `${toolItems.length} installed`,
        items: toolItems
      })
    }
  }
}
