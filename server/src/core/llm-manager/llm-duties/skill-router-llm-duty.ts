import { LlamaChatSession } from 'node-llama-cpp'

import {
  DEFAULT_INIT_PARAMS,
  LLMDuty,
  type LLMDutyInitParams,
  type LLMDutyParams,
  type LLMDutyResult
} from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'
import { LLM_MANAGER, LLM_PROVIDER } from '@/core'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'
import { LLM_PROVIDER as LLM_PROVIDER_NAME } from '@/constants'
import { StringHelper } from '@/helpers/string-helper'

type SkillRouterLLMDutyParams = LLMDutyParams

export const SYSTEM_PROMPT = `You are a skill routing AI. Your task is to analyze the User Query and select the single most appropriate skill from the list below based on the user's intent.

Respond using these rules:
- Output ONLY the exact skill name as listed below (e.g., "timer_skill", "greeting_skill").
- If no skill matches the user's intent, output ONLY: "None"
- Do not include any explanations, punctuation, markdown, or extra text.

Available Skills:
{{ SKILL_LIST }}

Carefully evaluate the user's true intent. Prioritize:
- Direct functional match (e.g., translation → translator_poc_skill)
- Actionability (can this skill fulfill the request?)
- Avoid keyword traps (e.g., "add" could be timer, todo, calendar — but only todo_list_skill handles lists)

--- Examples ---

User Query: "Translate 'Hello, how are you?' to Spanish."
Response: translator_skill

User Query: "Generate a logo for my startup 'Blue Widgets'"
Response: image_generation_skill

User Query: "Add 'Dentist Appointment' to my calendar for Tuesday at 3 PM."
Response: create_calendar_event_skill

User Query: "Just a test message, nothing to do."
Response: None

--- End Examples ---`

export class SkillRouterLLMDuty extends LLMDuty {
  private static instance: SkillRouterLLMDuty
  private static session: LlamaChatSession = null as unknown as LlamaChatSession
  protected readonly systemPrompt: LLMDutyParams['systemPrompt'] = null
  protected readonly name = 'Skill Router LLM Duty'
  protected input: LLMDutyParams['input'] = null

  constructor(params: SkillRouterLLMDutyParams) {
    super()

    if (!SkillRouterLLMDuty.instance) {
      LogHelper.title(this.name)
      LogHelper.success('New instance')

      SkillRouterLLMDuty.instance = this
    }

    this.input = params.input

    this.systemPrompt = StringHelper.findAndMap(SYSTEM_PROMPT, {
      '{{ SKILL_LIST }}': LLM_MANAGER.skillListContent || ''
    })
  }

  public async init(
    params: LLMDutyInitParams = DEFAULT_INIT_PARAMS
  ): Promise<void> {
    if (LLM_PROVIDER_NAME === LLMProviders.Local) {
      if (!SkillRouterLLMDuty.session || params.force) {
        LogHelper.title(this.name)
        LogHelper.info('Initializing...')

        try {
          /**
           * Dispose the previous session and sequence
           * to give space for the new one
           */
          if (params.force) {
            SkillRouterLLMDuty.session.dispose({ disposeSequence: true })
            LogHelper.info('Session disposed')
          }

          SkillRouterLLMDuty.session = new LlamaChatSession({
            contextSequence: LLM_MANAGER.context.getSequence(),
            autoDisposeSequence: true,
            systemPrompt: this.systemPrompt as string
          })

          LogHelper.success('Initialized')
        } catch (e) {
          LogHelper.title(this.name)
          LogHelper.error(`Failed to initialize: ${e}`)
        }
      }
    }
  }

  public async execute(): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    try {
      const prompt = `User Query: "${this.input}"\nChosen Skill Name: `
      const config = LLM_MANAGER.coreLLMDuties[LLMDuties.SkillRouter]
      const completionParams = {
        dutyType: LLMDuties.SkillRouter,
        systemPrompt: this.systemPrompt as string,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        thoughtTokensBudget: config.thoughtTokensBudget
      }
      let completionResult

      if (LLM_PROVIDER_NAME === LLMProviders.Local) {
        /*const history = await LLM_MANAGER.loadHistory(
          CONVERSATION_LOGGER,
          SkillRouterLLMDuty.session,
          { nbOfLogsToLoad: 8 }
        )*/

        /**
         * Setting history can be useful to load messages from the conversation
         * when starting a new session
         *
         * Only load the first item from the history (system prompt) to avoid
         * overloading the context with too many messages
         */
        // SkillRouterLLMDuty.session.setChatHistory([history[0] as ChatHistoryItem])

        completionResult = await LLM_PROVIDER.prompt(prompt, {
          ...completionParams,
          session: SkillRouterLLMDuty.session
        })
      } else {
        completionResult = await LLM_PROVIDER.prompt(prompt, completionParams)
      }

      LogHelper.title(this.name)
      LogHelper.success('Duty executed')
      LogHelper.success(`Prompt — ${prompt}`)
      LogHelper.success(`Output — ${JSON.stringify(completionResult?.output)}
usedInputTokens: ${completionResult?.usedInputTokens}
usedOutputTokens: ${completionResult?.usedOutputTokens}`)

      return completionResult as unknown as LLMDutyResult
    } catch (e) {
      LogHelper.title(this.name)
      LogHelper.error(`Failed to execute: ${e}`)
    }

    return null
  }
}
