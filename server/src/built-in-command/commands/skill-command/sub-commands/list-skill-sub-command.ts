import type {
  BuiltInCommandAutocompleteContext,
  BuiltInCommandAutocompleteItem,
  BuiltInCommandExecutionResult,
  BuiltInCommandResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'

import {
  getSkillSubcommandUsage,
  getSortedSkillAutocompleteEntries,
  SKILL_LIST_SUBCOMMAND
} from '../skill-command-helpers'

import type {
  SkillSubCommand,
  SkillSubCommandExecutionContext
} from './skill-sub-command'

export class ListSkillSubCommand implements SkillSubCommand {
  public readonly name = SKILL_LIST_SUBCOMMAND
  public readonly description = 'List all installed skills.'
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
      usage: getSkillSubcommandUsage(input.commandPrefix, this.name),
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
    context: SkillSubCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    void context

    return {
      status: 'completed',
      result: this.createSkillListResult()
    }
  }

  private createSkillListResult(): BuiltInCommandResult {
    const skillItems = getSortedSkillAutocompleteEntries().map((entry) => {
      return {
        label: `${entry.commandName}`,
        value: `format=${entry.format}, version=${entry.version}`,
        description: entry.description
      }
    })

    return createListResult({
      title: 'Skills',
      tone: 'info',
      header: `${skillItems.length} installed`,
      items: skillItems
    })
  }
}
