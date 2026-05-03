import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult,
  type BuiltInCommandLoadingMessageContext,
  type BuiltInCommandResult,
  type BuiltInCommandRenderListItem
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { RoutingMode, SkillFormat } from '@/types'

import {
  getSortedSkillAutocompleteEntries,
  matchSkillPrefix,
  matchesRequestedSkill,
  normalizeSkillSearchValue,
  SKILL_COMMAND_ALIAS,
  SKILL_COMMAND_FORMAT,
  SKILL_COMMAND_NAME,
  SKILL_COMMAND_PREFIXES,
  SKILL_DISABLE_COMMAND_FORMAT,
  SKILL_ENABLE_COMMAND_FORMAT,
  SKILL_LIST_COMMAND_FORMAT,
  SKILL_REMOVE_COMMAND_FORMAT,
  SKILL_ROOT_COMMAND_ALIAS_FORMAT,
  SKILL_ROOT_COMMAND_FORMAT,
  toSkillSuggestion,
  type ParsedSkillCommandInput
} from './skill-command-helpers'
import { DisableSkillSubCommand } from './sub-commands/disable-skill-sub-command'
import { EnableSkillSubCommand } from './sub-commands/enable-skill-sub-command'
import { ListSkillSubCommand } from './sub-commands/list-skill-sub-command'
import { RemoveSkillSubCommand } from './sub-commands/remove-skill-sub-command'
import type { SkillSubCommand } from './sub-commands/skill-sub-command'

export class SkillCommand extends BuiltInCommand {
  protected override description =
    'Browse skill subcommands or invoke a specific skill directly.'
  protected override icon_name = 'ri-magic-line'
  protected override supported_usages = [
    SKILL_ROOT_COMMAND_FORMAT,
    SKILL_ROOT_COMMAND_ALIAS_FORMAT
  ]
  protected override help_usage = SKILL_ROOT_COMMAND_FORMAT
  protected override aliases = [SKILL_COMMAND_ALIAS]

  private readonly subCommands: SkillSubCommand[] = [
    new ListSkillSubCommand(),
    new RemoveSkillSubCommand(),
    new EnableSkillSubCommand(),
    new DisableSkillSubCommand()
  ]

  public constructor() {
    super(SKILL_COMMAND_NAME)
  }

  public override getLoadingMessage(
    context: BuiltInCommandLoadingMessageContext
  ): string | null {
    const parsedInput = this.parseSkillCommandInput(context.raw_input)
    const requestedSkillName = parsedInput.skillEntry?.commandName || ''

    if (!requestedSkillName) {
      return null
    }

    return `Running "${requestedSkillName}"...`
  }

  public override shouldIncludeCommandSuggestionInAutocomplete(): boolean {
    return false
  }

  public override shouldRankAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): boolean {
    return !this.isSkillSelectionStep(
      context,
      this.parseSkillCommandInput(context.raw_input)
    )
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const parsedInput = this.parseSkillCommandInput(context.raw_input)
    const subcommandArgument = context.args[0]?.toLowerCase() || ''

    if (
      context.args.length === 0 ||
      (context.args.length === 1 && !context.ends_with_space)
    ) {
      return this.getRootSuggestions(
        parsedInput.commandPrefix,
        subcommandArgument
      )
    }

    const subCommand = this.getSubCommand(subcommandArgument)

    if (subCommand) {
      return subCommand.getAutocompleteItems({
        context,
        supportedUsages: this.getSupportedUsages()
      })
    }

    const skillSelectionStep = this.isSkillSelectionStep(context, parsedInput)
    const subcommandSuggestions = this.getSubcommandSuggestions(
      parsedInput.commandPrefix,
      parsedInput.rawSkillCandidate
    )

    if (!skillSelectionStep && !parsedInput.skillEntry) {
      return subcommandSuggestions
    }

    if (parsedInput.skillEntry && !skillSelectionStep) {
      return [
        toSkillSuggestion(
          parsedInput.skillEntry,
          {
            commandPrefix: parsedInput.commandPrefix,
            usage: context.raw_input.trim(),
            value: context.raw_input.trim()
          },
          this.getSupportedUsages()
        )
      ]
    }

    const skillSuggestions = getSortedSkillAutocompleteEntries()
      .filter((entry) =>
        matchesRequestedSkill(entry, parsedInput.rawSkillCandidate)
      )
      .map((entry) =>
        toSkillSuggestion(
          entry,
          {
            commandPrefix: parsedInput.commandPrefix
          },
          this.getSupportedUsages()
        )
      )

    return [...subcommandSuggestions, ...skillSuggestions]
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const parsedInput = this.parseSkillCommandInput(context.raw_input)
    const subcommand = context.args[0]?.toLowerCase() || ''
    const subCommand = this.getSubCommand(subcommand)

    if (subCommand) {
      return subCommand.execute({
        rawSkillName: context.args.slice(1).join(' ')
      })
    }

    const rawSkillName = parsedInput.rawSkillCandidate
    const normalizedSkillName = parsedInput.skillEntry?.skillName || ''
    const query = parsedInput.query

    if (!rawSkillName) {
      return {
        status: 'completed',
        result: this.createSkillSubcommandsResult()
      }
    }

    if (!parsedInput.skillEntry || !normalizedSkillName) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Unknown Skill',
          tone: 'error',
          items: [
            {
              label: `The skill "${rawSkillName}" is not supported.`,
              tone: 'error'
            },
            {
              label: 'Use /skill to inspect the available skills.',
              tone: 'error'
            }
          ]
        })
      }
    }

    const resolvedSkillCommandName = parsedInput.skillEntry.commandName
    const commandUtterance = query
      ? `${parsedInput.commandPrefix} ${resolvedSkillCommandName} ${query}`
      : `${parsedInput.commandPrefix} ${resolvedSkillCommandName}`
    const forcedRoutingMode =
      parsedInput.skillEntry.format === SkillFormat.AgentSkill
        ? RoutingMode.Agent
        : RoutingMode.Controlled
    const routeLabel =
      forcedRoutingMode === RoutingMode.Agent ? 'agent' : 'controlled'

    return {
      status: 'completed',
      result: createListResult({
        title: 'Skill Routed To Chat',
        tone: 'info',
        items: [
          {
            label: `Submitting "${resolvedSkillCommandName}" through the ${routeLabel} path.`
          }
        ]
      }),
      client_action: {
        type: 'submit_to_chat',
        utterance: commandUtterance,
        command_context: {
          forced_routing_mode: forcedRoutingMode,
          forced_skill_name: normalizedSkillName
        }
      }
    }
  }

  private getSubCommand(name: string): SkillSubCommand | null {
    return (
      this.subCommands.find((subCommand) => subCommand.name === name) ||
      null
    )
  }

  private isSkillSelectionStep(
    context: BuiltInCommandAutocompleteContext,
    parsedInput: ParsedSkillCommandInput
  ): boolean {
    if (!parsedInput.rawSkillCandidate) {
      return true
    }

    return (
      parsedInput.query === '' &&
      !context.ends_with_space
    )
  }

  private parseSkillCommandInput(rawInput: string): ParsedSkillCommandInput {
    const trimmedInput = rawInput.trimStart()
    const [rawCommandName = ''] = trimmedInput.split(/\s+/, 1)
    const normalizedCommandName = rawCommandName.toLowerCase()
    const commandPrefix =
      normalizedCommandName === `/${SKILL_COMMAND_ALIAS}`
        ? `/${SKILL_COMMAND_ALIAS}`
        : `/${this.getName()}`
    const rawRemainder = SKILL_COMMAND_PREFIXES.has(normalizedCommandName)
      ? trimmedInput.slice(rawCommandName.length).trim()
      : ''
    const sortedEntries = getSortedSkillAutocompleteEntries().sort(
      (firstEntry, secondEntry) => {
        const firstLength = normalizeSkillSearchValue(
          firstEntry.commandName
        ).length
        const secondLength = normalizeSkillSearchValue(
          secondEntry.commandName
        ).length

        if (firstLength !== secondLength) {
          return secondLength - firstLength
        }

        return secondEntry.commandName.length - firstEntry.commandName.length
      }
    )

    for (const entry of sortedEntries) {
      const matchedPrefix = matchSkillPrefix(
        rawRemainder,
        entry.commandName
      )

      if (!matchedPrefix) {
        continue
      }

      return {
        commandPrefix,
        rawSkillCandidate: matchedPrefix,
        query: rawRemainder.slice(matchedPrefix.length).trim(),
        skillEntry: entry
      }
    }

    return {
      commandPrefix,
      rawSkillCandidate: rawRemainder,
      query: '',
      skillEntry: null
    }
  }

  private getSubcommandSuggestions(
    commandPrefix: string,
    rawSkillCandidate: string
  ): BuiltInCommandAutocompleteItem[] {
    const normalizedRawSkillCandidate =
      normalizeSkillSearchValue(rawSkillCandidate)

    return this.subCommands
      .filter(
        (subCommand) =>
          !normalizedRawSkillCandidate ||
          subCommand.name.startsWith(normalizedRawSkillCandidate)
      )
      .map((subCommand) =>
        subCommand.getSuggestion({
          commandPrefix,
          supportedUsages: this.getSupportedUsages()
        })
      )
  }

  private getRootSuggestions(
    commandPrefix: string,
    rawSkillCandidate: string
  ): BuiltInCommandAutocompleteItem[] {
    const subcommandSuggestions = this.getSubcommandSuggestions(
      commandPrefix,
      rawSkillCandidate
    )
    const skillSuggestions = getSortedSkillAutocompleteEntries()
      .filter((entry) => matchesRequestedSkill(entry, rawSkillCandidate))
      .map((entry) =>
        toSkillSuggestion(
          entry,
          {
            commandPrefix
          },
          this.getSupportedUsages()
        )
      )

    return [...subcommandSuggestions, ...skillSuggestions]
  }

  private createSkillSubcommandsResult(): BuiltInCommandResult {
    const installedSkillsCount = getSortedSkillAutocompleteEntries().length
    const items: BuiltInCommandRenderListItem[] = [
      {
        label: SKILL_LIST_COMMAND_FORMAT,
        description: `List all installed skills (${installedSkillsCount}).`
      },
      {
        label: SKILL_REMOVE_COMMAND_FORMAT,
        description: 'Remove a skill installed in the active profile.'
      },
      {
        label: SKILL_ENABLE_COMMAND_FORMAT,
        description: 'Enable a disabled skill.'
      },
      {
        label: SKILL_DISABLE_COMMAND_FORMAT,
        description: 'Disable an enabled skill.'
      },
      {
        label: SKILL_COMMAND_FORMAT,
        description: 'Invoke a specific skill directly.'
      }
    ]

    return createListResult({
      title: 'Skill Command',
      tone: 'info',
      items
    })
  }
}
