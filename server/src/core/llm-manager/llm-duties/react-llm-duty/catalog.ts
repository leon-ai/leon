import { TOOLKIT_REGISTRY } from '@/core'

import {
  CATALOG_TOKEN_BUDGET,
  CHARS_PER_TOKEN
} from './constants'
import type { Catalog, FunctionConfig } from './types'

export function buildCatalog(): Catalog {
  const flattenedTools = TOOLKIT_REGISTRY.getFlattenedTools()
  const unavailableTools = TOOLKIT_REGISTRY.getUnavailableTools()
  const unavailableToolsSection = buildUnavailableToolsSection()

  // First try function-level catalog
  const functionLines: string[] = []
  for (const tool of flattenedTools) {
    const toolFunctions = TOOLKIT_REGISTRY.getToolFunctions(
      tool.toolkitId,
      tool.toolId
    )
    if (toolFunctions) {
      for (const [fnName, fnConfig] of Object.entries(toolFunctions) as [string, FunctionConfig][]) {
        // Include a small ordered parameter preview so the planner sees
        // useful optional inputs such as forecast dates without bloating
        // the catalog.
        const params = fnConfig.parameters
        const paramNames: string[] = []
        if (params && typeof params === 'object') {
          const properties = (params as Record<string, unknown>)['properties']
          if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
            paramNames.push(
              ...Object.keys(properties as Record<string, unknown>).slice(0, 5)
            )
          }
        }
        const paramHint = paramNames.length > 0
          ? ` (${paramNames.join(', ')})`
          : ''
        functionLines.push(
          `- ${tool.toolkitId}.${tool.toolId}.${fnName}${paramHint}: ${fnConfig.description}`
        )
      }
    }
  }

  const functionCatalog = functionLines.join('\n')
  const estimatedTokens = Math.ceil(
    functionCatalog.length / CHARS_PER_TOKEN
  )

  if (estimatedTokens <= CATALOG_TOKEN_BUDGET) {
    return {
      text: `Available Functions:\n${functionCatalog}${unavailableToolsSection}`,
      mode: 'function'
    }
  }

  // Fall back to tool-level catalog
  const toolLines: string[] = []
  for (const tool of flattenedTools) {
    toolLines.push(
      `- ${tool.toolkitId}.${tool.toolId}: ${tool.toolDescription}`
    )
  }

  return {
    text: `Available Tools:\n${toolLines.join('\n')}${unavailableToolsSection}`,
    mode: 'tool'
  }

  function buildUnavailableToolsSection(): string {
    if (unavailableTools.length === 0) {
      return ''
    }

    const unavailableLines = unavailableTools.map((tool) => {
      if (tool.missingSettings.length > 0 && tool.settingsPath) {
        return `- ${tool.toolkitId}.${tool.toolId}: missing ${tool.missingSettings.join(', ')}; configure ${tool.settingsPath}`
      }

      return `- ${tool.toolkitId}.${tool.toolId}: ${tool.reason || 'not available in the current runtime'}`
    })

    return [
      '',
      '',
      'Unavailable Installed Tools:',
      'These tools are installed but not callable right now. Do not plan them as executable steps; if the owner explicitly asks for one, explain the listed reason or missing settings path.',
      ...unavailableLines
    ].join('\n')
  }
}
