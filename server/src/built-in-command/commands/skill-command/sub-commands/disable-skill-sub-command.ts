import type {
  BuiltInCommandAutocompleteContext,
  BuiltInCommandAutocompleteItem,
  BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { ProfileHelper } from '@/helpers/profile-helper'

import {
  createSkillToggleSuccessResult,
  getSkillSubcommandUsage,
  getSortedSkillAutocompleteEntries,
  matchesRequestedSkill,
  resolveSkillEntry,
  SKILL_DISABLE_SUBCOMMAND,
  SKILL_ROOT_COMMAND_FORMAT,
  toSkillSuggestion
} from '../skill-command-helpers'

import type {
  SkillSubCommand,
  SkillSubCommandExecutionContext
} from './skill-sub-command'

export class DisableSkillSubCommand implements SkillSubCommand {
  public readonly name = SKILL_DISABLE_SUBCOMMAND
  public readonly description = 'Disable an enabled skill.'
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
      usage: getSkillSubcommandUsage(input.commandPrefix, this.name),
      supported_usages: input.supportedUsages,
      value: `${input.commandPrefix} ${this.name}`
    }
  }

  public getAutocompleteItems(input: {
    context: BuiltInCommandAutocompleteContext
    supportedUsages: string[]
  }): BuiltInCommandAutocompleteItem[] {
    const requestedSkillName = input.context.args.slice(1).join(' ')

    return getSortedSkillAutocompleteEntries()
      .filter((entry) =>
        matchesRequestedSkill(entry, requestedSkillName)
      )
      .map((entry) =>
        toSkillSuggestion(
          entry,
          {
            commandPrefix: `${SKILL_ROOT_COMMAND_FORMAT} ${this.name}`,
            usage: `${SKILL_ROOT_COMMAND_FORMAT} ${this.name} ${entry.commandName}`,
            value: `${SKILL_ROOT_COMMAND_FORMAT} ${this.name} ${entry.commandName}`
          },
          input.supportedUsages
        )
      )
  }

  public async execute(
    context: SkillSubCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const skillEntry = resolveSkillEntry(context.rawSkillName)

    if (!context.rawSkillName.trim()) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Missing Skill Name',
          tone: 'error',
          items: [
            {
              label: `Usage: ${SKILL_ROOT_COMMAND_FORMAT} ${this.name} <skill_name>`,
              tone: 'error'
            }
          ]
        })
      }
    }

    if (!skillEntry) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Unknown Skill',
          tone: 'error',
          items: [
            {
              label: `The skill "${context.rawSkillName.trim()}" is not available for this operation.`,
              tone: 'error'
            }
          ]
        })
      }
    }

    await ProfileHelper.disableSkill(skillEntry.skillName)

    return createSkillToggleSuccessResult('disabled', skillEntry)
  }
}
