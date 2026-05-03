import fs from 'node:fs'

import {
  LLM_SKILL_ROUTER_DUTY_SKILL_LIST_PATH
} from '@/constants'
import { ConversationLogger } from '@/conversation-logger'
import { LLMDuties } from '@/core/llm-manager/types'
import { LogHelper } from '@/helpers/log-helper'
import { getRoutingModeLLMDisplay } from '@/core/llm-manager/llm-routing'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

interface CoreLLMDutyConfig {
  maxTokens?: number
  temperature?: number
  thoughtTokensBudget?: number
}

interface CoreLLMDuties {
  [LLMDuties.SkillRouter]: CoreLLMDutyConfig
  [LLMDuties.ActionCalling]: CoreLLMDutyConfig
  [LLMDuties.SlotFilling]: CoreLLMDutyConfig
  [LLMDuties.Paraphrase]?: CoreLLMDutyConfig
}

type SkillListContent = string | null

const WORKFLOW_SKILL_ROUTER_MAX_TOKENS = 72
const WORKFLOW_ACTION_CALLING_MAX_TOKENS = 256
const WORKFLOW_SLOT_FILLING_MAX_TOKENS = 128
const WORKFLOW_PARAPHRASE_MAX_TOKENS = 8_192

// Workflow duties should stay fast and deterministic. The provider layer maps
// disableThinking to the strongest supported non-thinking / low-reasoning mode.
const CORE_LLM_DUTIES: CoreLLMDuties = {
  [LLMDuties.SkillRouter]: {
    maxTokens: WORKFLOW_SKILL_ROUTER_MAX_TOKENS,
    thoughtTokensBudget: 0,
    temperature: 0
  },
  [LLMDuties.ActionCalling]: {
    maxTokens: WORKFLOW_ACTION_CALLING_MAX_TOKENS,
    thoughtTokensBudget: 0,
    temperature: 0.1
  },
  [LLMDuties.SlotFilling]: {
    maxTokens: WORKFLOW_SLOT_FILLING_MAX_TOKENS,
    thoughtTokensBudget: 0,
    temperature: 0
  },
  [LLMDuties.Paraphrase]: {
    maxTokens: WORKFLOW_PARAPHRASE_MAX_TOKENS,
    thoughtTokensBudget: 0,
    temperature: 0.6
  }
}

function cloneCoreDutyConfig(): CoreLLMDuties {
  return {
    [LLMDuties.SkillRouter]: { ...CORE_LLM_DUTIES[LLMDuties.SkillRouter] },
    [LLMDuties.ActionCalling]: {
      ...CORE_LLM_DUTIES[LLMDuties.ActionCalling]
    },
    [LLMDuties.SlotFilling]: { ...CORE_LLM_DUTIES[LLMDuties.SlotFilling] },
    ...(CORE_LLM_DUTIES[LLMDuties.Paraphrase]
      ? {
          [LLMDuties.Paraphrase]: {
            ...CORE_LLM_DUTIES[LLMDuties.Paraphrase]
          }
        }
      : {})
  }
}

async function buildSkillListContent(): Promise<string> {
  const friendlyPrompts = await SkillDomainHelper.listSkillFriendlyPrompts()

  return friendlyPrompts
    .map((friendlyPrompt, index) => `${index + 1}. ${friendlyPrompt}`)
    .join('\n')
}

export default class LLMManager {
  private static instance: LLMManager
  private _isLLMEnabled = false
  // These placeholders remain for compatibility with code paths that still
  // compile against the old local-session surface, even though Local is disabled.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _llama: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _localModel: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _context: any = null
  private _skillListContent: SkillListContent = null
  private _coreLLMDuties = cloneCoreDutyConfig()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get llama(): any {
    return this._llama
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get model(): any {
    return this._localModel
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get context(): any {
    return this._context
  }

  get skillListContent(): SkillListContent {
    return this._skillListContent
  }

  get coreLLMDuties(): CoreLLMDuties {
    return this._coreLLMDuties
  }

  get isLLMEnabled(): boolean {
    return this._isLLMEnabled
  }

  constructor() {
    if (!LLMManager.instance) {
      LogHelper.title('LLM Manager')
      LogHelper.success('New instance')

      LLMManager.instance = this
    }
  }

  /**
   * Load files that only need to be loaded once.
   */
  private async singleLoad(): Promise<void> {
    try {
      this._skillListContent = await fs.promises.readFile(
        LLM_SKILL_ROUTER_DUTY_SKILL_LIST_PATH,
        'utf-8'
      )

      LogHelper.title('LLM Manager')
      LogHelper.success('Skill router skill list has been loaded')
    } catch (e) {
      throw new Error(`Failed to load the skill router skill list: ${e}`)
    }
  }

  public async init(): Promise<void> {
    LogHelper.time('LLM Manager init')
    this._isLLMEnabled = true

    try {
      await this.singleLoad()
    } catch (e) {
      LogHelper.title('LLM Manager')
      LogHelper.error(`LLM Manager failed to single load: ${e}`)

      process.exit(1)
    }

    LogHelper.title('LLM Manager')
    const modelState = CONFIG_STATE.getModelState()
    const routingMode = CONFIG_STATE.getRoutingModeState().getRoutingMode()
    const llmDisplay = getRoutingModeLLMDisplay(
      routingMode,
      modelState.getWorkflowTarget(),
      modelState.getAgentTarget()
    )
    LogHelper.success(`LLM manager initialized with ${llmDisplay.value}`)
    LogHelper.timeEnd('LLM Manager init')
  }

  public async refreshSkillListContent(): Promise<void> {
    const skillListContent = await buildSkillListContent()

    this._skillListContent = skillListContent

    LogHelper.title('LLM Manager')
    LogHelper.success('Skill router skill list has been refreshed in memory')
  }

  public async loadHistory(
    conversationLogger: ConversationLogger,
    session: { getChatHistory?: () => unknown[] },
    options?: { nbOfLogsToLoad?: number }
  ): Promise<unknown[]> {
    const [systemMessage] = session.getChatHistory?.() ?? []
    const conversationLogs = options
      ? await conversationLogger.load(options)
      : await conversationLogger.load()

    if (!conversationLogs) {
      return systemMessage ? [systemMessage] : []
    }

    const history = conversationLogs.map((messageRecord) => {
      const message = messageRecord?.message || ''

      if (messageRecord?.who === 'owner') {
        return {
          type: 'user',
          text: message
        }
      }

      return {
        type: 'model',
        response: [message]
      }
    })

    return systemMessage ? [systemMessage, ...history] : history
  }
}
