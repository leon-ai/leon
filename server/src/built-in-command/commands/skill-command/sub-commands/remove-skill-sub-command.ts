import type {
  BuiltInCommandAutocompleteContext,
  BuiltInCommandAutocompleteItem,
  BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

import {
  getSkillSubcommandUsage,
  getSortedSkillAutocompleteEntries,
  matchesRequestedSkill,
  resolveSkillEntry,
  SKILL_REMOVE_COMMAND_FORMAT,
  SKILL_REMOVE_SUBCOMMAND,
  SKILL_ROOT_COMMAND_FORMAT,
  toSkillSuggestion
} from '../skill-command-helpers'

import type {
  SkillSubCommand,
  SkillSubCommandExecutionContext
} from './skill-sub-command'

export class RemoveSkillSubCommand implements SkillSubCommand {
  public readonly name = SKILL_REMOVE_SUBCOMMAND
  public readonly description = 'Remove a profile-installed skill.'
  public readonly iconName = 'ri-delete-bin-line'

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

    return getSortedSkillAutocompleteEntries({
      onlyProfile: true
    })
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
    const skillEntry = resolveSkillEntry(context.rawSkillName, {
      onlyProfile: true
    })

    if (!context.rawSkillName.trim()) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Missing Skill Name',
          tone: 'error',
          items: [
            {
              label: `Usage: ${SKILL_REMOVE_COMMAND_FORMAT}`,
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
          title: 'Skill Not Installed In Profile',
          tone: 'error',
          items: [
            {
              label: `The skill "${context.rawSkillName.trim()}" is not installed in the active profile.`,
              tone: 'error'
            },
            {
              label:
                'Built-in skills cannot be removed from the codebase; use /skill disable <skill_name> instead.',
              tone: 'error'
            }
          ]
        })
      }
    }

    const removedSkill = await SkillDomainHelper.removeProfileSkill(
      skillEntry.skillName
    )

    if (!removedSkill) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Skill Not Removed',
          tone: 'error',
          items: [
            {
              label: `The skill "${skillEntry.commandName}" is no longer installed in the active profile.`,
              tone: 'error'
            }
          ]
        })
      }
    }

    return {
      status: 'completed',
      result: createListResult({
        title: 'Skill Removed',
        tone: 'success',
        items: [
          {
            label: `Removed "${removedSkill.commandName}" from the active profile.`,
            tone: 'success'
          }
        ]
      })
    }
  }
}
