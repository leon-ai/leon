import type {
  BuiltInCommandAutocompleteItem,
  BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { ProfileHelper } from '@/helpers/profile-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { SkillFormat } from '@/types'

export const SKILL_COMMAND_NAME = 'skill'
export const SKILL_COMMAND_ALIAS = 's'
export const SKILL_ROOT_COMMAND_FORMAT = '/skill'
export const SKILL_ROOT_COMMAND_ALIAS_FORMAT = '/s'
export const SKILL_LIST_SUBCOMMAND = 'list'
export const SKILL_REMOVE_SUBCOMMAND = 'remove'
export const SKILL_ENABLE_SUBCOMMAND = 'enable'
export const SKILL_DISABLE_SUBCOMMAND = 'disable'
export const SKILL_LIST_COMMAND_FORMAT = '/skill list'
export const SKILL_REMOVE_COMMAND_FORMAT = '/skill remove <skill_name>'
export const SKILL_ENABLE_COMMAND_FORMAT = '/skill enable <skill_name>'
export const SKILL_DISABLE_COMMAND_FORMAT = '/skill disable <skill_name>'
export const SKILL_COMMAND_FORMAT = '/skill <skill_name> <query>'
export const SKILL_COMMAND_PREFIXES = new Set([
  `/${SKILL_COMMAND_NAME}`,
  `/${SKILL_COMMAND_ALIAS}`
])

export interface SkillAutocompleteEntry {
  commandName: string
  description: string
  iconName: string
  isDisabled: boolean
  format: SkillFormat
  skillName: string
  version: string
}

export interface SkillAutocompleteOptions {
  includeDisabled?: boolean
  onlyDisabled?: boolean
  onlyProfile?: boolean
}

export interface ParsedSkillCommandInput {
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

export function normalizeSkillSearchValue(value: string): string {
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

export function getSkillSubcommandUsage(
  commandPrefix: string,
  subcommand: string
): string {
  if (subcommand === SKILL_LIST_SUBCOMMAND) {
    return `${commandPrefix} ${subcommand}`
  }

  return `${commandPrefix} ${subcommand} <skill_name>`
}

export function getSortedSkillAutocompleteEntries(
  options?: SkillAutocompleteOptions
): SkillAutocompleteEntry[] {
  const skillDescriptors = options?.onlyProfile
    ? SkillDomainHelper.listProfileSkillDescriptorsSync()
    : options?.includeDisabled
      ? SkillDomainHelper.listAllSkillDescriptorsSync()
      : SkillDomainHelper.listSkillDescriptorsSync()

  return skillDescriptors
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

export function matchesRequestedSkill(
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

export function toSkillSuggestion(
  entry: SkillAutocompleteEntry,
  input: SkillSuggestionUsageInput,
  supportedUsages: string[]
): BuiltInCommandAutocompleteItem {
  return {
    type: 'parameter',
    icon_name: entry.iconName,
    name: entry.commandName,
    description: entry.description,
    usage:
      input.usage || `${input.commandPrefix} ${entry.commandName} <query>`,
    supported_usages: supportedUsages,
    value: input.value || `${input.commandPrefix} ${entry.commandName}`
  }
}

export function resolveSkillEntry(
  rawSkillName: string,
  options?: SkillAutocompleteOptions
): SkillAutocompleteEntry | null {
  const normalizedRawSkillName = normalizeSkillSearchValue(rawSkillName)
  const collapsedRawSkillName = collapseSkillSearchValue(rawSkillName)

  if (!normalizedRawSkillName) {
    return null
  }

  const entries = getSortedSkillAutocompleteEntries(options)
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
    entries.find((entry) => matchesRequestedSkill(entry, rawSkillName)) ||
    null
  )
}

export function matchSkillPrefix(
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

export function createSkillToggleSuccessResult(
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
