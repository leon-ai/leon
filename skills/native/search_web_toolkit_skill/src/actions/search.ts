import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import { Settings } from '@sdk/settings'
import ToolManager from '@sdk/tool-manager'
import type { SkillToolExecutionResult } from '@@/bridges/runtime/contracts/skill-tool-protocol'

const TOOLKIT_ID = 'search_web'
const KEENABLE = 'keenable'
const GROK = 'grok'
const PROVIDER_NAMES = { [KEENABLE]: 'Keenable', [GROK]: 'Grok' }
const MODES = {
  web: { answer: 'web_search', grokFunction: 'searchWeb' },
  x: { answer: 'x_search', grokFunction: 'searchX' },
  both: { answer: 'combined_search', grokFunction: 'search' },
  deep_research: { answer: 'deep_research', grokFunction: 'deepResearch' }
} as const

interface SearchSkillSettings extends Record<string, unknown> {
  search_provider?: string
}

interface SearchToolOutput extends Record<string, unknown> {
  result?: {
    content?: string
    citations?: string[]
    data?: { results: Array<{ title: string, url: string, snippet: string }> }
  }
}

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  try {
    const query =
      (paramsHelper.getActionArgument('query') as string) ||
      paramsHelper.getContextData<string>('query')

    if (!query?.trim()) {
      leon.answer({ key: 'search_error', data: { error: 'A search query is required.' } })
      return
    }

    const searchType = paramsHelper.getActionArgument('search_type') ||
      paramsHelper.getContextData<string>('search_type')
    const deepResearch = paramsHelper.getActionArgument('deep_research') === 'true' ||
      paramsHelper.getContextData<boolean>('deep_research') === true
    const mode = deepResearch ? 'deep_research' :
      searchType === 'x' || searchType === 'both' ? searchType : 'web'
    const { answer, grokFunction } = MODES[mode]
    const maxResults = paramsHelper.getActionArgument('max_results') ??
      paramsHelper.getContextData<number>('max_results')
    const settings = new Settings<SearchSkillSettings>()
    const preferredProvider = mode === 'web' ? (await settings.get('search_provider') || KEENABLE) : GROK

    if (preferredProvider !== KEENABLE && preferredProvider !== GROK) {
      leon.answer({ key: 'provider_not_supported', data: { provider: preferredProvider } })
      return
    }

    const search = async (
      provider: keyof typeof PROVIDER_NAMES
    ): Promise<SkillToolExecutionResult<SearchToolOutput>> => {
      leon.answer({
        key: `${answer}_started`,
        data: { query, provider: PROVIDER_NAMES[provider] }
      })

      return ToolManager.executeTool<SearchToolOutput>({
        toolkitId: TOOLKIT_ID,
        toolId: provider,
        functionName: provider === KEENABLE ? 'searchWeb' : grokFunction,
        parsedInput: deepResearch
          ? { topic: query }
          : { query, ...(provider === KEENABLE && maxResults !== undefined
            ? { maxResults: Number(maxResults) } : {}) }
      })
    }

    let provider = preferredProvider
    let execution = await search(provider)

    // A stored Grok preference may predate provider setup. Keenable can
    // still serve ordinary web searches when Grok is unavailable.
    if (mode === 'web' && provider === GROK && (
      !execution.data.tool_id || execution.status === 'not_available' ||
      execution.data.output['missing_settings']
    )) {
      provider = KEENABLE
      execution = await search(provider)
    }

    const result = execution.data.output.result
    if (execution.status !== 'success' || !result) {
      const unavailableMessage = provider === KEENABLE
        ? 'Enable Keenable in Tools.'
        : 'Install or enable Grok in Tools.'

      leon.answer({
        key: 'search_error',
        data: {
          error: execution.data.tool_id
            ? execution.message
            : unavailableMessage
        }
      })
      return
    }

    const sources = result.data?.results || []
    const content = provider === KEENABLE
      ? sources.map(({ title, url, snippet }) =>
        `- [${title || url}](<${url}>)${snippet ? `\n  ${snippet}` : ''}`
      ).join('\n\n')
      : result.content || ''
    const citations = provider === KEENABLE ? sources.map(({ url }) => url) : result.citations || []

    leon.answer({
      key: provider === KEENABLE && sources.length === 0 ? 'web_search_no_results' : `${answer}_complete`,
      data: { query, content, citations_count: citations.length },
      core: {
        context_data: {
          search_query: query,
          search_results: content,
          citations,
          search_type: mode
        }
      }
    })
  } catch (error: unknown) {
    leon.answer({
      key: 'search_error',
      data: { error: (error as Error).message },
      core: { should_stop_skill: true }
    })
  }
}
