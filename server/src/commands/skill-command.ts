import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandLoadingMessageContext,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult,
  type BuiltInCommandResult
} from '@/commands/built-in-command'
import { createListResult } from '@/commands/built-in-command-renderer'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { ProfileHelper } from '@/helpers/profile-helper'
import { RoutingMode, SkillFormat } from '@/types'

const SKILL_COMMAND_NAME = 'skill'
const SKILL_COMMAND_ALIAS = 's'
const SKILL_ROOT_COMMAND_FORMAT = '/skill'
const SKILL_ROOT_COMMAND_ALIAS_FORMAT = '/s'
const SKILL_LIST_SUBCOMMAND = 'list'
const SKILL_ENABLE_SUBCOMMAND = 'enable'
const SKILL_DISABLE_SUBCOMMAND = 'disable'
const SKILL_LIST_COMMAND_FORMAT = '/skill list'
const SKILL_ENABLE_COMMAND_FORMAT = '/skill enable <skill_name>'
const SKILL_DISABLE_COMMAND_FORMAT = '/skill disable <skill_name>'
const SKILL_COMMAND_FORMAT = '/skill <skill_name> <query>'
const SKILL_COMMAND_PREFIXES = new Set([
  `/${SKILL_COMMAND_NAME}`,
  `/${SKILL_COMMAND_ALIAS}`
])
const SKILL_RESERVED_SUBCOMMANDS = [
  SKILL_LIST_SUBCOMMAND,
  SKILL_ENABLE_SUBCOMMAND,
  SKILL_DISABLE_SUBCOMMAND
]

interface SkillAutocompleteEntry {
  commandName: string
  description: string
  iconName: string
  isDisabled: boolean
  format: SkillFormat
  skillName: string
  version: string
}

interface SkillAutocompleteOptions {
  includeDisabled?: boolean
  onlyDisabled?: boolean
}

interface ParsedSkillCommandInput {
  commandPrefix: string
  rawSkillCandidate: string
  query: string
  skillEntry: SkillAutocompleteEntry | null
}

interface SkillSuggestionUsageInput {
  commandPrefix: string
  usage?: string
  value?: string
}

function normalizeSkillSearchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .trim()
}

function collapseSkillSearchValue(value: string): string {
  return normalizeSkillSearchValue(value).replace(/\s+/g, '')
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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

    if (this.isSkillToggleSubcommand(subcommandArgument)) {
      return this.getSkillToggleSuggestions(context, subcommandArgument)
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
        this.toSkillSuggestion(parsedInput.skillEntry, {
          commandPrefix: parsedInput.commandPrefix,
          usage: context.raw_input.trim(),
          value: context.raw_input.trim()
        })
      ]
    }

    const skillSuggestions = this.getSortedSkillAutocompleteEntries()
      .filter((entry) =>
        this.matchesRequestedSkill(entry, parsedInput.rawSkillCandidate)
      )
      .map((entry) =>
        this.toSkillSuggestion(entry, {
          commandPrefix: parsedInput.commandPrefix
        })
      )

    return [...subcommandSuggestions, ...skillSuggestions]
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const parsedInput = this.parseSkillCommandInput(context.raw_input)
    const subcommand = context.args[0]?.toLowerCase() || ''
    const rawSkillName = parsedInput.rawSkillCandidate
    const normalizedSkillName = parsedInput.skillEntry?.skillName || ''
    const query = parsedInput.query
    const normalizedRawSkillName = normalizeSkillSearchValue(rawSkillName)

    if (this.isSkillToggleSubcommand(subcommand)) {
      return this.executeSkillToggle(subcommand, context.args.slice(1).join(' '))
    }

    if (normalizedRawSkillName === SKILL_LIST_SUBCOMMAND && !query) {
      return {
        status: 'completed',
        result: this.createSkillListResult()
      }
    }

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

  private getSortedSkillAutocompleteEntries(
    options?: SkillAutocompleteOptions
  ): SkillAutocompleteEntry[] {
    const skillFolders = options?.includeDisabled
      ? SkillDomainHelper.listAllSkillDescriptorsSync()
      : SkillDomainHelper.listSkillDescriptorsSync()

    return skillFolders
      .map((skillDescriptor) => {
        const isDisabled = ProfileHelper.isSkillDisabled(skillDescriptor.id)

        if (options?.onlyDisabled && !isDisabled) {
          return null
        }

        return {
          commandName: skillDescriptor.commandName,
          description: skillDescriptor.description,
          iconName: skillDescriptor.iconName,
          isDisabled,
          format: skillDescriptor.format,
          skillName: skillDescriptor.id,
          version: skillDescriptor.version
        }
      })
      .filter(
        (entry): entry is SkillAutocompleteEntry => entry !== null
      )
      .sort((firstEntry, secondEntry) =>
        firstEntry.commandName.localeCompare(secondEntry.commandName)
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
    const sortedEntries = this.getSortedSkillAutocompleteEntries().sort(
      (firstEntry, secondEntry) => {
        const firstLength = normalizeSkillSearchValue(firstEntry.commandName).length
        const secondLength =
          normalizeSkillSearchValue(secondEntry.commandName).length

        if (firstLength !== secondLength) {
          return secondLength - firstLength
        }

        return secondEntry.commandName.length - firstEntry.commandName.length
      }
    )

    for (const entry of sortedEntries) {
      const matchedPrefix = this.matchSkillPrefix(
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

  private matchesRequestedSkill(
    entry: SkillAutocompleteEntry,
    rawSkillName: string
  ): boolean {
    const normalizedRequestedSkillName = normalizeSkillSearchValue(rawSkillName)
    const collapsedRequestedSkillName = collapseSkillSearchValue(rawSkillName)

    if (!normalizedRequestedSkillName) {
      return true
    }

    const normalizedCommandName = normalizeSkillSearchValue(entry.commandName)
    const normalizedSkillName = normalizeSkillSearchValue(entry.skillName)
    const collapsedCommandName = collapseSkillSearchValue(entry.commandName)
    const collapsedSkillName = collapseSkillSearchValue(entry.skillName)

    return (
      normalizedCommandName.includes(normalizedRequestedSkillName) ||
      normalizedSkillName.includes(normalizedRequestedSkillName) ||
      collapsedCommandName.includes(collapsedRequestedSkillName) ||
      collapsedSkillName.includes(collapsedRequestedSkillName)
    )
  }

  private toSkillSuggestion(
    entry: SkillAutocompleteEntry,
    input: SkillSuggestionUsageInput
  ): BuiltInCommandAutocompleteItem {
    return {
      type: 'parameter',
      icon_name: entry.iconName,
      name: entry.commandName,
      description: entry.description,
      usage:
        input.usage || `${input.commandPrefix} ${entry.commandName} <query>`,
      supported_usages: this.getSupportedUsages(),
      value: input.value || `${input.commandPrefix} ${entry.commandName}`
    }
  }

  private getSubcommandSuggestions(
    commandPrefix: string,
    rawSkillCandidate: string
  ): BuiltInCommandAutocompleteItem[] {
    const normalizedRawSkillCandidate = normalizeSkillSearchValue(rawSkillCandidate)

    return SKILL_RESERVED_SUBCOMMANDS
      .filter(
        (subcommand) =>
          !normalizedRawSkillCandidate ||
          subcommand.startsWith(normalizedRawSkillCandidate)
      )
      .map((subcommand) => {
        const description =
          subcommand === SKILL_LIST_SUBCOMMAND
            ? 'List all installed skills.'
            : subcommand === SKILL_ENABLE_SUBCOMMAND
              ? 'Enable a disabled skill.'
              : 'Disable an enabled skill.'

        return {
          type: 'parameter',
          icon_name:
            subcommand === SKILL_LIST_SUBCOMMAND
              ? 'ri-list-check-3'
              : subcommand === SKILL_ENABLE_SUBCOMMAND
                ? 'ri-checkbox-circle-line'
                : 'ri-checkbox-blank-circle-line',
          name: subcommand,
          description,
          usage: `${commandPrefix} ${subcommand}`,
          supported_usages: this.getSupportedUsages(),
          value: `${commandPrefix} ${subcommand}`
        }
      })
  }

  private getRootSuggestions(
    commandPrefix: string,
    rawSkillCandidate: string
  ): BuiltInCommandAutocompleteItem[] {
    const subcommandSuggestions = this.getSubcommandSuggestions(
      commandPrefix,
      rawSkillCandidate
    )
    const skillSuggestions = this.getSortedSkillAutocompleteEntries()
      .filter((entry) => this.matchesRequestedSkill(entry, rawSkillCandidate))
      .map((entry) =>
        this.toSkillSuggestion(entry, {
          commandPrefix
        })
      )

    return [...subcommandSuggestions, ...skillSuggestions]
  }

  private createSkillListResult(): BuiltInCommandResult {
    const skillItems = this.getSortedSkillAutocompleteEntries().map((entry) => {
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

  private createSkillSubcommandsResult(): BuiltInCommandResult {
    const installedSkillsCount = this.getSortedSkillAutocompleteEntries().length

    return createListResult({
      title: 'Skill Command',
      tone: 'info',
      items: [
        {
          label: SKILL_LIST_COMMAND_FORMAT,
          description: `List all installed skills (${installedSkillsCount}).`
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
    })
  }

  private matchSkillPrefix(
    rawValue: string,
    skillCommandName: string
  ): string | null {
    const skillParts = skillCommandName
      .split(/[_-]/)
      .map((part) => part.trim())
      .filter(Boolean)

    if (skillParts.length === 0) {
      return null
    }

    const separatorPattern = '(?:[-_\\s]+)'
    const skillPattern = skillParts.map(escapeForRegExp).join(separatorPattern)
    const prefixPattern = new RegExp(`^${skillPattern}(?=$|\\s)`, 'i')
    const match = rawValue.match(prefixPattern)

    return match?.[0]?.trim() || null
  }

  private isSkillToggleSubcommand(subcommand: string): boolean {
    return (
      subcommand === SKILL_ENABLE_SUBCOMMAND ||
      subcommand === SKILL_DISABLE_SUBCOMMAND
    )
  }

  private getSkillToggleSuggestions(
    context: BuiltInCommandAutocompleteContext,
    subcommand: string
  ): BuiltInCommandAutocompleteItem[] {
    const requestedSkillName = context.args.slice(1).join(' ')
    const entries = this.getSortedSkillAutocompleteEntries({
      includeDisabled: subcommand === SKILL_ENABLE_SUBCOMMAND,
      onlyDisabled: subcommand === SKILL_ENABLE_SUBCOMMAND
    })

    return entries
      .filter((entry) =>
        this.matchesRequestedSkill(entry, requestedSkillName)
      )
      .map((entry) =>
        this.toSkillSuggestion(entry, {
          commandPrefix: `${SKILL_ROOT_COMMAND_FORMAT} ${subcommand}`,
          usage: `${SKILL_ROOT_COMMAND_FORMAT} ${subcommand} ${entry.commandName}`,
          value: `${SKILL_ROOT_COMMAND_FORMAT} ${subcommand} ${entry.commandName}`
        })
      )
  }

  private async executeSkillToggle(
    subcommand: string,
    rawSkillName: string
  ): Promise<BuiltInCommandExecutionResult> {
    const skillEntry = this.resolveSkillEntry(rawSkillName, {
      includeDisabled: subcommand === SKILL_ENABLE_SUBCOMMAND,
      onlyDisabled: subcommand === SKILL_ENABLE_SUBCOMMAND
    })

    if (!rawSkillName.trim()) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Missing Skill Name',
          tone: 'error',
          items: [
            {
              label: `Usage: /skill ${subcommand} <skill_name>`,
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
              label: `The skill "${rawSkillName.trim()}" is not available for this operation.`,
              tone: 'error'
            }
          ]
        })
      }
    }

    if (subcommand === SKILL_ENABLE_SUBCOMMAND) {
      await ProfileHelper.enableSkill(skillEntry.skillName)

      return this.createSkillToggleSuccessResult('enabled', skillEntry)
    }

    await ProfileHelper.disableSkill(skillEntry.skillName)

    return this.createSkillToggleSuccessResult('disabled', skillEntry)
  }

  private resolveSkillEntry(
    rawSkillName: string,
    options?: SkillAutocompleteOptions
  ): SkillAutocompleteEntry | null {
    const normalizedRawSkillName = normalizeSkillSearchValue(rawSkillName)
    const collapsedRawSkillName = collapseSkillSearchValue(rawSkillName)

    if (!normalizedRawSkillName) {
      return null
    }

    const entries = this.getSortedSkillAutocompleteEntries(options)
    const exactEntry = entries.find((entry) => {
      return (
        normalizeSkillSearchValue(entry.commandName) === normalizedRawSkillName ||
        normalizeSkillSearchValue(entry.skillName) === normalizedRawSkillName ||
        collapseSkillSearchValue(entry.commandName) === collapsedRawSkillName ||
        collapseSkillSearchValue(entry.skillName) === collapsedRawSkillName
      )
    })

    if (exactEntry) {
      return exactEntry
    }

    return (
      entries.find((entry) => this.matchesRequestedSkill(entry, rawSkillName)) ||
      null
    )
  }

  private createSkillToggleSuccessResult(
    action: 'enabled' | 'disabled',
    entry: SkillAutocompleteEntry
  ): BuiltInCommandExecutionResult {
    return {
      status: 'completed',
      result: createListResult({
        title: action === 'enabled' ? 'Skill Enabled' : 'Skill Disabled',
        tone: 'success',
        items: [
          {
            label: `The skill "${entry.commandName}" is now ${action}.`,
            tone: 'success'
          }
        ]
      })
    }
  }
}
