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
import { RoutingMode } from '@/types'

import {
  getSortedToolAutocompleteEntries,
  matchToolPrefix,
  matchesRequestedTool,
  normalizeToolSearchValue,
  TOOL_COMMAND_ALIAS,
  TOOL_COMMAND_FORMAT,
  TOOL_COMMAND_NAME,
  TOOL_COMMAND_PREFIXES,
  TOOL_DISABLE_COMMAND_FORMAT,
  TOOL_ENABLE_COMMAND_FORMAT,
  TOOL_LIST_COMMAND_FORMAT,
  TOOL_ROOT_COMMAND_ALIAS_FORMAT,
  TOOL_ROOT_COMMAND_FORMAT,
  toToolSuggestion,
  type ParsedToolCommandInput
} from './tool-command-helpers'
import { DisableToolSubCommand } from './sub-commands/disable-tool-sub-command'
import { EnableToolSubCommand } from './sub-commands/enable-tool-sub-command'
import { ListToolSubCommand } from './sub-commands/list-tool-sub-command'
import type { ToolSubCommand } from './sub-commands/tool-sub-command'

export class ToolCommand extends BuiltInCommand {
  protected override description =
    'Browse tool subcommands or invoke a specific tool directly.'
  protected override icon_name = 'ri-tools-line'
  protected override supported_usages = [
    TOOL_ROOT_COMMAND_FORMAT,
    TOOL_ROOT_COMMAND_ALIAS_FORMAT
  ]
  protected override help_usage = TOOL_ROOT_COMMAND_FORMAT
  protected override aliases = [TOOL_COMMAND_ALIAS]

  private readonly subCommands: ToolSubCommand[] = [
    new ListToolSubCommand(),
    new EnableToolSubCommand(),
    new DisableToolSubCommand()
  ]

  public constructor() {
    super(TOOL_COMMAND_NAME)
  }

  public override getLoadingMessage(
    context: BuiltInCommandLoadingMessageContext
  ): string | null {
    const parsedInput = this.parseToolCommandInput(context.raw_input)
    const requestedToolName = parsedInput.toolEntry?.qualifiedName || ''

    if (!requestedToolName) {
      return null
    }

    return `Running "${requestedToolName}"...`
  }

  public override shouldIncludeCommandSuggestionInAutocomplete(): boolean {
    return false
  }

  public override shouldRankAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): boolean {
    return !this.isToolSelectionStep(
      context,
      this.parseToolCommandInput(context.raw_input)
    )
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const parsedInput = this.parseToolCommandInput(context.raw_input)
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

    const toolSelectionStep = this.isToolSelectionStep(context, parsedInput)
    const subcommandSuggestions = this.getSubcommandSuggestions(
      parsedInput.commandPrefix,
      parsedInput.rawToolCandidate
    )

    if (!toolSelectionStep && !parsedInput.toolEntry) {
      return subcommandSuggestions
    }

    if (parsedInput.toolEntry && !toolSelectionStep) {
      return [
        toToolSuggestion(
          parsedInput.toolEntry,
          {
            commandPrefix: parsedInput.commandPrefix,
            usage: context.raw_input.trim(),
            value: context.raw_input.trim()
          },
          this.getSupportedUsages()
        )
      ]
    }

    const toolSuggestions = getSortedToolAutocompleteEntries()
      .filter((entry) =>
        matchesRequestedTool(entry, parsedInput.rawToolCandidate)
      )
      .map((entry) =>
        toToolSuggestion(
          entry,
          {
            commandPrefix: parsedInput.commandPrefix
          },
          this.getSupportedUsages()
        )
      )

    return [...subcommandSuggestions, ...toolSuggestions]
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const parsedInput = this.parseToolCommandInput(context.raw_input)
    const subcommand = context.args[0]?.toLowerCase() || ''
    const subCommand = this.getSubCommand(subcommand)

    if (subCommand) {
      return subCommand.execute({
        rawToolName: context.args.slice(1).join(' ')
      })
    }

    const rawToolName = parsedInput.rawToolCandidate
    const query = parsedInput.query

    if (!rawToolName) {
      return {
        status: 'completed',
        result: this.createToolSubcommandsResult()
      }
    }

    if (!parsedInput.toolEntry) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Unknown Tool',
          tone: 'error',
          items: [
            {
              label: `The tool "${rawToolName}" is not supported.`,
              tone: 'error'
            },
            {
              label: 'Use /tool to inspect the available tools.',
              tone: 'error'
            }
          ]
        })
      }
    }

    const resolvedToolName = parsedInput.toolEntry.qualifiedName
    const commandUtterance = query
      ? `${parsedInput.commandPrefix} ${resolvedToolName} ${query}`
      : `${parsedInput.commandPrefix} ${resolvedToolName}`

    return {
      status: 'completed',
      result: createListResult({
        title: 'Tool Routed To Chat',
        tone: 'info',
        items: [
          {
            label: `Submitting "${resolvedToolName}" through the agent path.`
          }
        ]
      }),
      client_action: {
        type: 'submit_to_chat',
        utterance: commandUtterance,
        command_context: {
          forced_routing_mode: RoutingMode.Agent,
          forced_tool_name: resolvedToolName
        }
      }
    }
  }

  private getSubCommand(name: string): ToolSubCommand | null {
    return (
      this.subCommands.find((subCommand) => subCommand.name === name) ||
      null
    )
  }

  private isToolSelectionStep(
    context: BuiltInCommandAutocompleteContext,
    parsedInput: ParsedToolCommandInput
  ): boolean {
    if (!parsedInput.rawToolCandidate) {
      return true
    }

    return (
      parsedInput.query === '' &&
      !context.ends_with_space
    )
  }

  private parseToolCommandInput(rawInput: string): ParsedToolCommandInput {
    const trimmedInput = rawInput.trimStart()
    const [rawCommandName = ''] = trimmedInput.split(/\s+/, 1)
    const normalizedCommandName = rawCommandName.toLowerCase()
    const commandPrefix =
      normalizedCommandName === `/${TOOL_COMMAND_ALIAS}`
        ? `/${TOOL_COMMAND_ALIAS}`
        : `/${this.getName()}`
    const rawRemainder = TOOL_COMMAND_PREFIXES.has(normalizedCommandName)
      ? trimmedInput.slice(rawCommandName.length).trim()
      : ''
    const sortedEntries = getSortedToolAutocompleteEntries().sort(
      (firstEntry, secondEntry) => {
        const firstLength = normalizeToolSearchValue(
          firstEntry.qualifiedName
        ).length
        const secondLength = normalizeToolSearchValue(
          secondEntry.qualifiedName
        ).length

        if (firstLength !== secondLength) {
          return secondLength - firstLength
        }

        return secondEntry.qualifiedName.length - firstEntry.qualifiedName.length
      }
    )

    for (const entry of sortedEntries) {
      const matchedPrefix = matchToolPrefix(
        rawRemainder,
        entry.qualifiedName
      )

      if (!matchedPrefix) {
        continue
      }

      return {
        commandPrefix,
        rawToolCandidate: matchedPrefix,
        query: rawRemainder.slice(matchedPrefix.length).trim(),
        toolEntry: entry
      }
    }

    return {
      commandPrefix,
      rawToolCandidate: rawRemainder,
      query: '',
      toolEntry: null
    }
  }

  private getSubcommandSuggestions(
    commandPrefix: string,
    rawToolCandidate: string
  ): BuiltInCommandAutocompleteItem[] {
    const normalizedRawToolCandidate =
      normalizeToolSearchValue(rawToolCandidate)

    return this.subCommands
      .filter(
        (subCommand) =>
          !normalizedRawToolCandidate ||
          subCommand.name.startsWith(normalizedRawToolCandidate)
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
    rawToolCandidate: string
  ): BuiltInCommandAutocompleteItem[] {
    const subcommandSuggestions = this.getSubcommandSuggestions(
      commandPrefix,
      rawToolCandidate
    )
    const toolSuggestions = getSortedToolAutocompleteEntries()
      .filter((entry) => matchesRequestedTool(entry, rawToolCandidate))
      .map((entry) =>
        toToolSuggestion(
          entry,
          {
            commandPrefix
          },
          this.getSupportedUsages()
        )
      )

    return [...subcommandSuggestions, ...toolSuggestions]
  }

  private createToolSubcommandsResult(): BuiltInCommandResult {
    const installedToolsCount = getSortedToolAutocompleteEntries({
      includeDisabled: true
    }).length
    const items: BuiltInCommandRenderListItem[] = [
      {
        label: TOOL_LIST_COMMAND_FORMAT,
        description: `List all installed tools (${installedToolsCount}).`
      },
      {
        label: TOOL_ENABLE_COMMAND_FORMAT,
        description: 'Enable a disabled tool.'
      },
      {
        label: TOOL_DISABLE_COMMAND_FORMAT,
        description: 'Disable an enabled tool.'
      },
      {
        label: TOOL_COMMAND_FORMAT,
        description: 'Invoke a specific tool directly through agent mode.'
      }
    ]

    return createListResult({
      title: 'Tool Command',
      tone: 'info',
      items
    })
  }
}
