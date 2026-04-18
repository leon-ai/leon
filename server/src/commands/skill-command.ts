import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandLoadingMessageContext,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult
} from '@/commands/built-in-command'
import { createListResult } from '@/commands/built-in-command-renderer'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { RoutingMode } from '@/types'

const SKILL_COMMAND_NAME = 'skill'
const SKILL_COMMAND_ALIAS = 's'
const SKILL_COMMAND_FORMAT = '/skill <skill_name> <query>'
const SKILL_COMMAND_ALIAS_FORMAT = '/s <skill_name> <query>'
const SKILL_COMMAND_PREFIXES = new Set([
  `/${SKILL_COMMAND_NAME}`,
  `/${SKILL_COMMAND_ALIAS}`
])

interface SkillAutocompleteEntry {
  commandName: string
  description: string
  iconName: string
  skillName: string
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
    .replace(/[_\s]+/g, ' ')
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
    'Invoke a specific skill directly with a natural language query.'
  protected override icon_name = 'ri-magic-line'
  protected override supported_usages = [
    SKILL_COMMAND_FORMAT,
    SKILL_COMMAND_ALIAS_FORMAT
  ]
  protected override help_usage = SKILL_COMMAND_FORMAT
  protected override aliases = [SKILL_COMMAND_ALIAS]

  public constructor() {
    super(SKILL_COMMAND_NAME)
  }

  public override getLoadingMessage(
    context: BuiltInCommandLoadingMessageContext
  ): string | null {
    const parsedInput = this.parseSkillCommandInput(context.raw_input)
    const requestedSkillName = parsedInput.skillEntry?.commandName || ''
    const { query } = parsedInput

    if (!requestedSkillName || !query) {
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
    const skillSelectionStep = this.isSkillSelectionStep(context, parsedInput)

    if (!skillSelectionStep && !parsedInput.skillEntry) {
      return []
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

    return this.getSortedSkillAutocompleteEntries()
      .filter((entry) =>
        this.matchesRequestedSkill(entry, parsedInput.rawSkillCandidate)
      )
      .map((entry) =>
        this.toSkillSuggestion(entry, {
          commandPrefix: parsedInput.commandPrefix
        })
      )
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const parsedInput = this.parseSkillCommandInput(context.raw_input)
    const rawSkillName = parsedInput.rawSkillCandidate
    const normalizedSkillName = parsedInput.skillEntry?.skillName || ''
    const query = parsedInput.query

    if (!rawSkillName) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Missing Skill Name',
          tone: 'error',
          items: [
            {
              label: 'Please provide a skill name.',
              tone: 'error'
            },
            {
              label: 'Usage',
              value: SKILL_COMMAND_FORMAT,
              tone: 'error'
            }
          ]
        })
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

    if (!query) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Missing Query',
          tone: 'error',
          items: [
            {
              label: `Please provide a query for "${SkillDomainHelper.getSkillCommandName(normalizedSkillName)}".`,
              tone: 'error'
            },
            {
              label: 'Usage',
              value: SKILL_COMMAND_FORMAT,
              tone: 'error'
            }
          ]
        })
      }
    }

    const resolvedSkillCommandName = parsedInput.skillEntry.commandName
    const commandUtterance =
      `${parsedInput.commandPrefix} ${resolvedSkillCommandName} ${query}`.trim()

    return {
      status: 'completed',
      result: createListResult({
        title: 'Skill Routed To Chat',
        tone: 'info',
        items: [
          {
            label: `Submitting "${resolvedSkillCommandName}" through the normal workflow path.`
          }
        ]
      }),
      client_action: {
        type: 'submit_to_chat',
        utterance: commandUtterance,
        command_context: {
          forced_routing_mode: RoutingMode.Workflow,
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

  private getSortedSkillAutocompleteEntries(): SkillAutocompleteEntry[] {
    return SkillDomainHelper.listSkillFoldersSync()
      .map((skillName) => {
        try {
          const skillConfig = SkillDomainHelper.getNewSkillConfigSync(skillName)

          if (!skillConfig) {
            return null
          }

          return {
            commandName: SkillDomainHelper.getSkillCommandName(skillName),
            description: skillConfig.description,
            iconName: skillConfig.icon_name,
            skillName
          }
        } catch {
          return null
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

  private matchSkillPrefix(
    rawValue: string,
    skillCommandName: string
  ): string | null {
    const skillParts = skillCommandName
      .split('_')
      .map((part) => part.trim())
      .filter(Boolean)

    if (skillParts.length === 0) {
      return null
    }

    const separatorPattern = '(?:[_\\s]+)'
    const skillPattern = skillParts.map(escapeForRegExp).join(separatorPattern)
    const prefixPattern = new RegExp(`^${skillPattern}(?=$|\\s)`, 'i')
    const match = rawValue.match(prefixPattern)

    return match?.[0]?.trim() || null
  }
}
