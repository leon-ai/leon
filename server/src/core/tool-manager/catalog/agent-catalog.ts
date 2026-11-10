import type { OpenAITool } from '@/core/llm-manager/types'
import {
  normalizeSearchText, prepareSearchQuery, rankSearchFields, SearchRank
} from '@/helpers/search-helper'
import { TOOL_CATALOG, getCatalogToolState, isCatalogToolRestricted } from './catalog'
import { CatalogToolState } from '../tool-source'

export const CATALOG_SEARCH_TOOL_NAME = 'search_tool_catalog'
const MAXIMUM_RESULTS = 5
const MAXIMUM_QUERY_LENGTH = 256
const MAXIMUM_RESULT_NAME_LENGTH = 128

/**
 * Exposes one small on-demand discovery contract, not every catalog schema.
 */
export function createCatalogSearchTool(): OpenAITool {
  return {
    type: 'function',
    function: {
      name: CATALOG_SEARCH_TOOL_NAME,
      description: 'Check local catalog availability and connection status by service name or capability before claiming an integration is unavailable. Read-only; a single setup-needed match displays a trusted Add/Enable/Connect card. Only the owner can authorize those actions.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: {
            type: 'string', minLength: 1, maxLength: MAXIMUM_QUERY_LENGTH,
            description: 'Service name, tool ID, or capability to find.'
          }
        },
        required: ['query']
      }
    }
  }
}

/**
 * Searches local metadata only. Suggestions never enter the callable registry;
 * showing a setup card does not install packages, contact providers or grant access.
 */
export async function searchAgentCatalog(input: Record<string, unknown>): Promise<string> {
  const query = input['query']
  if (typeof query !== 'string' || !query.trim() || query.length > MAXIMUM_QUERY_LENGTH) {
    return 'Catalog search requires a short service name or capability.'
  }

  const prepared = prepareSearchQuery(query)
  if (!prepared.compact) {
    return 'Catalog search requires a service name or capability.'
  }

  const ranked = (await TOOL_CATALOG.list({ presentation: false }))
    .map((tool) => ({
      tool,
      rank: rankSearchFields(
        [tool.id, tool.name, tool.description].map(normalizeSearchText), prepared
      )
    }))
    .filter(({ rank }) => rank !== SearchRank.None)
    .sort((a, b) => a.rank - b.rank)
  const matches = ranked.slice(0, MAXIMUM_RESULTS)
  const first = matches[0]

  // Only an unambiguous result gets a card; broader searches return choices
  // which the agent can narrow by exact ID without flooding the conversation.
  const selected = first && (ranked.length === 1 || first.rank === SearchRank.Exact && ranked[1]?.rank !== SearchRank.Exact)
    ? first.tool : undefined
  let setupShown = false
  if (selected && getCatalogToolState(selected) !== CatalogToolState.Ready && !isCatalogToolRestricted(selected)) {
    const { emitConnectionWidget } = await import('@/core/connections/connection-widget')
    emitConnectionWidget(selected.id, selected)
    setupShown = true
  }

  return JSON.stringify({
    tools: matches.map(({ tool }) => ({
      id: tool.id, name: tool.name.slice(0, MAXIMUM_RESULT_NAME_LENGTH), description: tool.description,
      kind: tool.kind, state: getCatalogToolState(tool), restricted: isCatalogToolRestricted(tool)
    })),
    has_more: ranked.length > matches.length,
    ...(setupShown ? {
      setup_card: selected!.id,
      next_step: 'The owner can use the card to add, enable or connect this tool. Do not claim account access or install it yourself.'
    } : {})
  })
}
