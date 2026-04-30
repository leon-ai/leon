import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import { Settings } from '@sdk/settings'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import GrokTool from '@tools/search_web/grok'

interface SearchSkillSettings extends Record<string, unknown> {
  search_provider?: string
  grok_model?: string
  grok_temperature?: number
  grok_max_tokens?: number
}

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  try {
    // Load settings
    const settings = new Settings<SearchSkillSettings>()
    const provider =
      ((await settings.get('search_provider')) as string) || 'grok'

    // Get parameters
    const query =
      (paramsHelper.getActionArgument('query') as string) ||
      paramsHelper.getContextData<string>('query')

    if (!query) {
      leon.answer({
        key: 'search_error',
        data: {
          error: 'Search query is required'
        }
      })
      return
    }

    const searchType = ((paramsHelper.getActionArgument(
      'search_type'
    ) as string) ||
      paramsHelper.getContextData<string>('search_type') ||
      'web') as 'web' | 'x' | 'both'

    const deepResearch =
      (paramsHelper.getActionArgument('deep_research') as string) === 'true' ||
      paramsHelper.getContextData<boolean>('deep_research') === true

    // Check provider support
    if (provider !== 'grok') {
      leon.answer({
        key: 'provider_not_supported',
        data: {
          provider
        }
      })
      return
    }

    // Initialize Grok
    const grok = await ToolManager.initTool(GrokTool)

    // Perform search based on type
    if (deepResearch) {
      // Deep research mode using agentic web search
      leon.answer({
        key: 'deep_research_started',
        data: {
          query,
          provider: 'Grok'
        }
      })

      const result = await grok.deepResearch(query)

      if (!result.success) {
        leon.answer({
          key: 'search_error',
          data: {
            error: result.error || 'Unknown error during deep research'
          }
        })
        return
      }

      // Extract content and citations from Responses API
      const content = result.content || ''
      const citations = result.citations || []

      leon.answer({
        key: 'deep_research_complete',
        data: {
          query,
          content,
          citations_count: citations.length
        },
        core: {
          context_data: {
            search_query: query,
            search_results: content,
            citations,
            search_type: 'deep_research'
          }
        }
      })
    } else if (searchType === 'web') {
      // Web search using server-side web_search tool
      leon.answer({
        key: 'web_search_started',
        data: {
          query,
          provider: 'Grok'
        }
      })

      const result = await grok.searchWeb(query)

      if (!result.success) {
        leon.answer({
          key: 'search_error',
          data: {
            error: result.error || 'Unknown error during web search'
          }
        })
        return
      }

      // Extract content and citations from Responses API
      const content = result.content || ''
      const citations = result.citations || []

      leon.answer({
        key: 'web_search_complete',
        data: {
          query,
          content,
          citations_count: citations.length
        },
        core: {
          context_data: {
            search_query: query,
            search_results: content,
            citations,
            search_type: 'web'
          }
        }
      })
    } else if (searchType === 'x') {
      // X/Twitter search using server-side x_search tool
      leon.answer({
        key: 'x_search_started',
        data: {
          query,
          provider: 'Grok'
        }
      })

      const result = await grok.searchX(query)

      if (!result.success) {
        leon.answer({
          key: 'search_error',
          data: {
            error: result.error || 'Unknown error during X search'
          }
        })
        return
      }

      // Extract content and citations from Responses API
      const content = result.content || ''
      const citations = result.citations || []

      leon.answer({
        key: 'x_search_complete',
        data: {
          query,
          content,
          citations_count: citations.length
        },
        core: {
          context_data: {
            search_query: query,
            search_results: content,
            citations,
            search_type: 'x'
          }
        }
      })
    } else {
      // Combined search (both web and X) using both tools
      leon.answer({
        key: 'combined_search_started',
        data: {
          query,
          provider: 'Grok'
        }
      })

      const result = await grok.search(query)

      if (!result.success) {
        leon.answer({
          key: 'search_error',
          data: {
            error: result.error || 'Unknown error during combined search'
          }
        })
        return
      }

      // Extract content and citations from Responses API
      const content = result.content || ''
      const citations = result.citations || []

      leon.answer({
        key: 'combined_search_complete',
        data: {
          query,
          content,
          citations_count: citations.length
        },
        core: {
          context_data: {
            search_query: query,
            search_results: content,
            citations,
            search_type: 'both'
          }
        }
      })
    }
  } catch (error: unknown) {
    if (isMissingToolSettingsError(error)) {
      return
    }
    leon.answer({
      key: 'search_error',
      data: {
        error: (error as Error).message
      },
      core: {
        should_stop_skill: true
      }
    })
  }
}
