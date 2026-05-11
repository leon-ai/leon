import fs from 'node:fs'
import path from 'node:path'

import type {
  BuiltInCommandAutocompleteItem,
  BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import {
  PROFILE_TOOLS_PATH,
  TOOLS_PATH
} from '@/constants'
import { ProfileHelper } from '@/helpers/profile-helper'

export const TOOL_COMMAND_NAME = 'tool'
export const TOOL_COMMAND_ALIAS = 't'
export const TOOL_ROOT_COMMAND_FORMAT = '/tool'
export const TOOL_ROOT_COMMAND_ALIAS_FORMAT = '/t'
export const TOOL_LIST_SUBCOMMAND = 'list'
export const TOOL_ENABLE_SUBCOMMAND = 'enable'
export const TOOL_DISABLE_SUBCOMMAND = 'disable'
export const TOOL_LIST_COMMAND_FORMAT = '/tool list'
export const TOOL_ENABLE_COMMAND_FORMAT = '/tool enable <toolkit>.<tool_name>'
export const TOOL_DISABLE_COMMAND_FORMAT = '/tool disable <toolkit>.<tool_name>'
export const TOOL_COMMAND_FORMAT = '/tool <toolkit>.<tool_name> <query>'
export const TOOL_COMMAND_PREFIXES = new Set([
  `/${TOOL_COMMAND_NAME}`,
  `/${TOOL_COMMAND_ALIAS}`
])

interface ToolkitConfig {
  name: string
  description: string
  icon_name: string
  tools?: string[]
}

interface ToolConfig {
  name: string
  description: string
  icon_name?: string
}

export interface ToolAutocompleteEntry {
  qualifiedName: string
  toolkitId: string
  toolkitName: string
  toolkitDescription: string
  toolkitIconName: string
  toolId: string
  toolName: string
  description: string
  iconName: string
  isDisabled: boolean
}

export interface ToolAutocompleteOptions {
  includeDisabled?: boolean
  onlyDisabled?: boolean
}

export interface ParsedToolCommandInput {
  commandPrefix: string
  rawToolCandidate: string
  query: string
  toolEntry: ToolAutocompleteEntry | null
}

interface ToolSuggestionUsageInput {
  commandPrefix: string
  usage?: string
  value?: string
}

export function normalizeToolSearchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._-\s]+/g, ' ')
    .trim()
}

function collapseToolSearchValue(value: string): string {
  return normalizeToolSearchValue(value).replace(/\s+/g, '')
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readJSONFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

export function getToolSubcommandUsage(
  commandPrefix: string,
  subcommand: string
): string {
  if (subcommand === TOOL_LIST_SUBCOMMAND) {
    return `${commandPrefix} ${subcommand}`
  }

  return `${commandPrefix} ${subcommand} <toolkit>.<tool_name>`
}

export function getQualifiedToolId(toolkitId: string, toolId: string): string {
  return `${toolkitId}.${toolId}`
}

export function getSortedToolAutocompleteEntries(
  options?: ToolAutocompleteOptions
): ToolAutocompleteEntry[] {
  const toolsByQualifiedId = new Map<string, ToolAutocompleteEntry>()

  for (const toolsPath of [TOOLS_PATH, PROFILE_TOOLS_PATH]) {
    if (!fs.existsSync(toolsPath)) {
      continue
    }

    for (const toolkitId of fs.readdirSync(toolsPath)) {
      const toolkitPath = path.join(toolsPath, toolkitId)
      const toolkitConfigPath = path.join(toolkitPath, 'toolkit.json')

      if (!fs.existsSync(toolkitConfigPath)) {
        continue
      }

      const toolkitConfig = readJSONFile<ToolkitConfig>(toolkitConfigPath)
      if (!toolkitConfig) {
        continue
      }

      for (const toolId of toolkitConfig.tools || []) {
        const toolConfigPath = path.join(toolkitPath, toolId, 'tool.json')
        const toolConfig = readJSONFile<ToolConfig>(toolConfigPath)

        if (!toolConfig) {
          continue
        }

        const qualifiedName = getQualifiedToolId(toolkitId, toolId)
        const isDisabled = ProfileHelper.isToolDisabled(toolId, toolkitId)

        if (!options?.includeDisabled && isDisabled) {
          continue
        }

        if (options?.onlyDisabled && !isDisabled) {
          continue
        }

        toolsByQualifiedId.set(qualifiedName, {
          qualifiedName,
          toolkitId,
          toolkitName: toolkitConfig.name,
          toolkitDescription: toolkitConfig.description,
          toolkitIconName: toolkitConfig.icon_name,
          toolId,
          toolName: toolConfig.name,
          description: toolConfig.description,
          iconName: toolConfig.icon_name || toolkitConfig.icon_name,
          isDisabled
        })
      }
    }
  }

  return [...toolsByQualifiedId.values()].sort((firstEntry, secondEntry) =>
    firstEntry.qualifiedName.localeCompare(secondEntry.qualifiedName)
  )
}

export function matchesRequestedTool(
  entry: ToolAutocompleteEntry,
  rawToolName: string
): boolean {
  const normalizedRequestedToolName = normalizeToolSearchValue(rawToolName)
  const collapsedRequestedToolName = collapseToolSearchValue(rawToolName)

  if (!normalizedRequestedToolName) {
    return true
  }

  const normalizedQualifiedName = normalizeToolSearchValue(entry.qualifiedName)
  const normalizedToolId = normalizeToolSearchValue(entry.toolId)
  const normalizedToolName = normalizeToolSearchValue(entry.toolName)
  const collapsedQualifiedName = collapseToolSearchValue(entry.qualifiedName)
  const collapsedToolId = collapseToolSearchValue(entry.toolId)
  const collapsedToolName = collapseToolSearchValue(entry.toolName)

  return (
    normalizedQualifiedName.includes(normalizedRequestedToolName) ||
    normalizedToolId.includes(normalizedRequestedToolName) ||
    normalizedToolName.includes(normalizedRequestedToolName) ||
    collapsedQualifiedName.includes(collapsedRequestedToolName) ||
    collapsedToolId.includes(collapsedRequestedToolName) ||
    collapsedToolName.includes(collapsedRequestedToolName)
  )
}

export function toToolSuggestion(
  entry: ToolAutocompleteEntry,
  input: ToolSuggestionUsageInput,
  supportedUsages: string[]
): BuiltInCommandAutocompleteItem {
  return {
    type: 'parameter',
    icon_name: entry.iconName,
    name: entry.qualifiedName,
    description: entry.description,
    usage:
      input.usage || `${input.commandPrefix} ${entry.qualifiedName} <query>`,
    supported_usages: supportedUsages,
    value: input.value || `${input.commandPrefix} ${entry.qualifiedName}`
  }
}

export function resolveToolEntry(
  rawToolName: string,
  options?: ToolAutocompleteOptions
): ToolAutocompleteEntry | null {
  const normalizedRawToolName = normalizeToolSearchValue(rawToolName)
  const collapsedRawToolName = collapseToolSearchValue(rawToolName)

  if (!normalizedRawToolName) {
    return null
  }

  const entries = getSortedToolAutocompleteEntries(options)
  const exactEntry = entries.find((entry) => {
    return (
      normalizeToolSearchValue(entry.qualifiedName) === normalizedRawToolName ||
      normalizeToolSearchValue(entry.toolId) === normalizedRawToolName ||
      collapseToolSearchValue(entry.qualifiedName) === collapsedRawToolName ||
      collapseToolSearchValue(entry.toolId) === collapsedRawToolName
    )
  })

  if (exactEntry) {
    return exactEntry
  }

  return (
    entries.find((entry) => matchesRequestedTool(entry, rawToolName)) ||
    null
  )
}

export function matchToolPrefix(
  rawValue: string,
  qualifiedToolName: string
): string | null {
  const toolParts = qualifiedToolName
    .split(/[._-]/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (toolParts.length === 0) {
    return null
  }

  const separatorPattern = '(?:[._-]|\\s)+'
  const toolPattern = toolParts.map(escapeForRegExp).join(separatorPattern)
  const prefixPattern = new RegExp(`^${toolPattern}(?=$|\\s)`, 'i')
  const match = rawValue.match(prefixPattern)

  return match?.[0]?.trim() || null
}

export function createToolToggleSuccessResult(
  action: 'enabled' | 'disabled',
  entry: ToolAutocompleteEntry
): BuiltInCommandExecutionResult {
  return {
    status: 'completed',
    result: createListResult({
      title: action === 'enabled' ? 'Tool Enabled' : 'Tool Disabled',
      tone: 'success',
      items: [
        {
          label: `The tool "${entry.qualifiedName}" is now ${action}.`,
          tone: 'success'
        }
      ]
    })
  }
}
