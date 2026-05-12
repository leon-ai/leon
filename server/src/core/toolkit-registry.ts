import fs from 'node:fs'
import path from 'node:path'

import {
  PROFILE_TOOLS_PATH,
  TOOLS_PATH
} from '@/constants'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { LLMProviders } from '@/core/llm-manager/types'
import { LogHelper } from '@/helpers/log-helper'
import { ProfileHelper } from '@/helpers/profile-helper'

const HOSTED_SEARCH_TOOLKIT_ID = 'search_web'
const HOSTED_SEARCH_TOOL_ID = 'hosted'
const HOSTED_SEARCH_PROVIDERS = new Set<LLMProviders>([
  LLMProviders.OpenAI,
  LLMProviders.Anthropic
])

interface ToolkitToolDefinition {
  tool_id: string
  toolkit_id: string
  name: string
  description: string
  icon_name?: string
  binaries?: Record<string, string>
  resources?: Record<string, string[]>
  functions: Record<
    string,
    {
      description: string
      parameters: Record<string, unknown>
      output_schema?: Record<string, unknown>
      hooks?: {
        post_execution?: {
          response_jq?: string
        }
      }
    }
  >
}

interface FlattenedToolkitTool {
  toolkitId: string
  toolkitName: string
  toolkitDescription: string
  toolkitIconName: string
  toolId: string
  toolName: string
  toolDescription: string
  toolIconName: string
}

interface UnavailableToolkitTool extends FlattenedToolkitTool {
  missingSettings: string[]
  settingsPath: string | null
  reason?: string
}

interface ToolAvailability {
  available: boolean
  requiredSettings: string[]
  missingSettings: string[]
  settingsPath: string | null
  reason?: string
}

interface ResolvedToolkitTool {
  toolkitId: string
  toolkitName: string
  toolkitIconName: string
  toolId: string
  toolName: string
  toolDescription: string
  toolIconName: string
}

interface ToolkitDefinition {
  id: string
  name: string
  description: string
  iconName: string
  contextFiles?: string[]
  tools?: Record<string, ToolkitToolDefinition>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

export default class ToolkitRegistry {
  private static instance: ToolkitRegistry
  private _toolkits: ToolkitDefinition[] = []
  private _toolAvailability = new Map<string, ToolAvailability>()
  private _isLoaded = false

  constructor() {
    if (!ToolkitRegistry.instance) {
      LogHelper.title('Toolkit Registry')
      LogHelper.success('New instance')

      ToolkitRegistry.instance = this
    }
  }

  public get toolkits(): ToolkitDefinition[] {
    return this._toolkits
  }

  public get isLoaded(): boolean {
    return this._isLoaded
  }

  public getFlattenedTools(): FlattenedToolkitTool[] {
    const flattened: FlattenedToolkitTool[] = []

    for (const toolkit of this._toolkits) {
      if (!toolkit.tools) {
        continue
      }

      for (const [toolId, tool] of Object.entries(toolkit.tools)) {
        if (!this.isToolAvailable(toolkit.id, toolId)) {
          continue
        }

        flattened.push({
          toolkitId: toolkit.id,
          toolkitName: toolkit.name,
          toolkitDescription: toolkit.description,
          toolkitIconName: toolkit.iconName,
          toolId,
          toolName: tool.name,
          toolDescription: tool.description,
          toolIconName: tool.icon_name || toolkit.iconName
        })
      }
    }

    return flattened
  }

  public getUnavailableTools(): UnavailableToolkitTool[] {
    const unavailable: UnavailableToolkitTool[] = []

    for (const toolkit of this._toolkits) {
      if (!toolkit.tools) {
        continue
      }

      for (const [toolId, tool] of Object.entries(toolkit.tools)) {
        const availability = this.getToolAvailability(toolkit.id, toolId)
        if (availability.available) {
          continue
        }

        const unavailableTool: UnavailableToolkitTool = {
          toolkitId: toolkit.id,
          toolkitName: toolkit.name,
          toolkitDescription: toolkit.description,
          toolkitIconName: toolkit.iconName,
          toolId,
          toolName: tool.name,
          toolDescription: tool.description,
          toolIconName: tool.icon_name || toolkit.iconName,
          missingSettings: availability.missingSettings,
          settingsPath: availability.settingsPath
        }
        if (availability.reason) {
          unavailableTool.reason = availability.reason
        }

        unavailable.push(unavailableTool)
      }
    }

    return unavailable
  }

  public getToolAvailability(
    toolkitId: string,
    toolId: string
  ): ToolAvailability {
    const availability = this._toolAvailability.get(
      this.getQualifiedToolId(toolkitId, toolId)
    )

    if (!availability) {
      return {
        available: true,
        requiredSettings: [],
        missingSettings: [],
        settingsPath: null
      }
    }

    const dynamicUnavailableReason = this.getDynamicUnavailableReason(
      toolkitId,
      toolId
    )

    if (availability.requiredSettings.length === 0 || !availability.settingsPath) {
      return {
        ...availability,
        available: !dynamicUnavailableReason,
        missingSettings: [],
        ...(dynamicUnavailableReason
          ? { reason: dynamicUnavailableReason }
          : {})
      }
    }

    const configuredSettings = this.readSettingsSync(availability.settingsPath)
    const missingSettings = availability.requiredSettings.filter((key) =>
      this.isMissingSetting(configuredSettings[key])
    )

    return {
      ...availability,
      available: missingSettings.length === 0 && !dynamicUnavailableReason,
      missingSettings,
      ...(dynamicUnavailableReason
        ? { reason: dynamicUnavailableReason }
        : {})
    }
  }

  public isToolAvailable(toolkitId: string, toolId: string): boolean {
    return this.getToolAvailability(toolkitId, toolId).available
  }

  public resolveToolById(
    toolId: string,
    toolkitId?: string
  ): ResolvedToolkitTool | null {
    if (!toolId) {
      return null
    }

    const normalizedToolId = toolId.trim()
    if (!normalizedToolId) {
      return null
    }

    if (toolkitId) {
      const toolkit = this._toolkits.find((item) => item.id === toolkitId)
      const tool = toolkit?.tools?.[normalizedToolId]

      if (!tool || !toolkit) {
        return null
      }

      return {
        toolkitId: toolkit.id,
        toolkitName: toolkit.name,
        toolkitIconName: toolkit.iconName,
        toolId: normalizedToolId,
        toolName: tool.name,
        toolDescription: tool.description,
        toolIconName: tool.icon_name || toolkit.iconName
      }
    }

    const toolkitAndToolId = normalizedToolId.split('.')
    const hasToolkitPrefix = toolkitAndToolId.length === 2

    if (hasToolkitPrefix) {
      const [toolkitIdFromTool, toolKey] = toolkitAndToolId
      if (!toolkitIdFromTool || !toolKey) {
        return null
      }
      const toolkit = this._toolkits.find(
        (item) => item.id === toolkitIdFromTool
      )
      const tool = toolkit?.tools?.[toolKey]

      if (!tool || !toolkit) {
        return null
      }

      return {
        toolkitId: toolkit.id,
        toolkitName: toolkit.name,
        toolkitIconName: toolkit.iconName,
        toolId: toolKey,
        toolName: tool.name,
        toolDescription: tool.description,
        toolIconName: tool.icon_name || toolkit.iconName
      }
    }

    const matches: ResolvedToolkitTool[] = []
    for (const toolkit of this._toolkits) {
      if (!toolkit.tools) {
        continue
      }

      const tool = toolkit.tools[normalizedToolId]
      if (tool) {
        matches.push({
          toolkitId: toolkit.id,
          toolkitName: toolkit.name,
          toolkitIconName: toolkit.iconName,
          toolId: normalizedToolId,
          toolName: tool.name,
          toolDescription: tool.description,
          toolIconName: tool.icon_name || toolkit.iconName
        })
      }
    }

    if (matches.length === 1) {
      return matches[0] || null
    }

    return null
  }

  public getToolFunctions(
    toolkitId: string,
    toolId: string
  ): ToolkitToolDefinition['functions'] | null {
    const toolkit = this._toolkits.find((item) => item.id === toolkitId)
    const tool = toolkit?.tools?.[toolId]
    if (!tool) {
      return null
    }

    return tool.functions || null
  }

  public getToolkitContextFiles(toolkitId: string): string[] {
    const toolkit = this._toolkits.find((item) => item.id === toolkitId)
    return toolkit?.contextFiles || []
  }

  public setFunctionParameterEnum(
    toolkitId: string,
    toolId: string,
    functionName: string,
    parameterName: string,
    enumValues: string[]
  ): boolean {
    const functions = this.getToolFunctions(toolkitId, toolId)
    const functionConfig = functions?.[functionName]
    if (!functionConfig) {
      return false
    }

    const parameters = asRecord(functionConfig.parameters)
    const properties = asRecord(parameters?.['properties'])
    const parameterSchema = asRecord(properties?.[parameterName])
    if (!parameterSchema) {
      return false
    }

    const normalizedValues = [...new Set(
      enumValues
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )]

    parameterSchema['enum'] = normalizedValues

    return true
  }

  public async load(): Promise<void> {
    if (this._isLoaded) {
      return
    }

    try {
      const toolkitsById = new Map<string, ToolkitDefinition>()

      await this.loadBuiltInToolkits(toolkitsById)

      const toolkits = [...toolkitsById.values()].filter(
        (toolkit) => toolkit.tools && Object.keys(toolkit.tools).length > 0
      )

      this._toolkits = toolkits
      this._isLoaded = true

      LogHelper.title('Toolkit Registry')
      LogHelper.success(`Loaded ${toolkits.length} toolkits`)
    } catch (e) {
      LogHelper.title('Toolkit Registry')
      LogHelper.error(`Failed to load toolkits: ${e}`)
    }
  }

  public async reload(): Promise<void> {
    this._toolkits = []
    this._toolAvailability.clear()
    this._isLoaded = false

    await this.load()
  }

  private async loadBuiltInToolkits(
    toolkitsById: Map<string, ToolkitDefinition>
  ): Promise<void> {
    for (const toolsPath of [TOOLS_PATH, PROFILE_TOOLS_PATH]) {
      if (!fs.existsSync(toolsPath)) {
        continue
      }

      const entries = await fs.promises.readdir(toolsPath, {
        withFileTypes: true
      })

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }

        const toolkitId = entry.name
        const toolkitPath = path.join(toolsPath, toolkitId)
        const toolkitConfigPath = path.join(toolkitPath, 'toolkit.json')

        if (!fs.existsSync(toolkitConfigPath)) {
          continue
        }

        try {
          const toolkitConfig = await this.loadToolkitConfig(toolkitConfigPath)
          const existingToolkit = toolkitsById.get(toolkitId)
          const toolkit: ToolkitDefinition = existingToolkit || {
            id: toolkitId,
            name: toolkitConfig.name,
            description: toolkitConfig.description,
            iconName: toolkitConfig.icon_name,
            contextFiles: this.normalizeContextFiles(
              toolkitConfig.context_files
            ),
            tools: {}
          }

          for (const toolId of toolkitConfig.tools || []) {
            if (ProfileHelper.isToolDisabled(toolId, toolkitId)) {
              continue
            }

            await this.loadToolConfig(
              toolkit,
              toolId,
              path.join(toolkitPath, toolId, 'tool.json')
            )
          }

          toolkitsById.set(toolkitId, toolkit)
        } catch (e) {
          LogHelper.title('Toolkit Registry')
          LogHelper.error(
            `Failed to load toolkit config at "${toolkitConfigPath}": ${e}`
          )
        }
      }
    }
  }

  private async loadToolkitConfig(toolkitConfigPath: string): Promise<{
    name: string
    description: string
    icon_name: string
    context_files?: string[]
    tools?: string[]
  }> {
    return JSON.parse(
      await fs.promises.readFile(toolkitConfigPath, 'utf-8')
    ) as {
      name: string
      description: string
      icon_name: string
      context_files?: string[]
      tools?: string[]
    }
  }

  private async loadToolConfig(
    toolkit: ToolkitDefinition,
    toolId: string,
    toolConfigPath: string
  ): Promise<void> {
    if (!fs.existsSync(toolConfigPath)) {
      return
    }

    try {
      const toolConfigRaw = await fs.promises.readFile(toolConfigPath, 'utf-8')
      const toolConfig = JSON.parse(toolConfigRaw) as ToolkitToolDefinition
      toolkit.tools = {
        ...(toolkit.tools || {}),
        [toolId]: toolConfig
      }
      this._toolAvailability.set(
        this.getQualifiedToolId(toolkit.id, toolId),
        await this.resolveToolAvailability(toolkit.id, toolId, toolConfigPath)
      )
    } catch (e) {
      LogHelper.title('Toolkit Registry')
      LogHelper.error(
        `Failed to load tool config at "${toolConfigPath}": ${e}`
      )
    }
  }

  private normalizeContextFiles(contextFiles: unknown): string[] {
    return Array.isArray(contextFiles)
      ? [
          ...new Set(
            contextFiles
              .map((contextFile) => this.normalizeContextFilename(contextFile))
              .filter((contextFile): contextFile is string =>
                Boolean(contextFile)
              )
          )
        ]
      : []
  }

  private normalizeContextFilename(filename: unknown): string | null {
    if (typeof filename !== 'string') {
      return null
    }

    const trimmedFilename = filename.trim()
    if (!trimmedFilename) {
      return null
    }

    const normalizedBasename = path
      .basename(trimmedFilename, '.md')
      .toUpperCase()
    if (!normalizedBasename) {
      return null
    }

    return `${normalizedBasename}.md`
  }

  private getQualifiedToolId(toolkitId: string, toolId: string): string {
    return `${toolkitId}.${toolId}`
  }

  private getDynamicUnavailableReason(
    toolkitId: string,
    toolId: string
  ): string | null {
    if (
      toolkitId !== HOSTED_SEARCH_TOOLKIT_ID ||
      toolId !== HOSTED_SEARCH_TOOL_ID
    ) {
      return null
    }

    const target = CONFIG_STATE.getModelState().getAgentTarget()
    if (!target.isEnabled) {
      return 'active agent LLM is disabled'
    }

    if (!target.isResolved || !target.model) {
      return 'active agent LLM target is not resolved'
    }

    if (this.supportsHostedSearch(target.provider)) {
      return null
    }

    return `active agent LLM ${target.provider}/${target.model} does not support native hosted search`
  }

  private supportsHostedSearch(provider: LLMProviders): boolean {
    return HOSTED_SEARCH_PROVIDERS.has(provider)
  }

  private async resolveToolAvailability(
    toolkitId: string,
    toolId: string,
    toolConfigPath: string
  ): Promise<ToolAvailability> {
    const settingsPath = path.join(
      PROFILE_TOOLS_PATH,
      toolkitId,
      toolId,
      'settings.json'
    )
    const settingsSamplePath = path.join(
      path.dirname(toolConfigPath),
      'settings.sample.json'
    )
    const requiredSettings = await this.getRequiredSettings(settingsSamplePath)

    if (requiredSettings.length === 0) {
      return {
        available: true,
        requiredSettings,
        missingSettings: [],
        settingsPath
      }
    }

    const configuredSettings = await this.readSettings(settingsPath)
    const missingSettings = requiredSettings.filter((key) =>
      this.isMissingSetting(configuredSettings[key])
    )

    return {
      available: missingSettings.length === 0,
      requiredSettings,
      missingSettings,
      settingsPath
    }
  }

  private async getRequiredSettings(settingsSamplePath: string): Promise<string[]> {
    const sampleSettings = await this.readSettings(settingsSamplePath)

    return Object.entries(sampleSettings)
      .filter(([, value]) => value === null)
      .map(([key]) => key)
  }

  private async readSettings(
    settingsPath: string
  ): Promise<Record<string, unknown>> {
    try {
      if (!fs.existsSync(settingsPath)) {
        return {}
      }

      return JSON.parse(
        await fs.promises.readFile(settingsPath, 'utf-8')
      ) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private readSettingsSync(settingsPath: string): Record<string, unknown> {
    try {
      if (!fs.existsSync(settingsPath)) {
        return {}
      }

      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<
        string,
        unknown
      >
    } catch {
      return {}
    }
  }

  private isMissingSetting(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '')
    )
  }
}
