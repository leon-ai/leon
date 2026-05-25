import {
  LLMDuty,
  type LLMDutyParams,
  type LLMDutyResult
} from '@/core/llm-manager/llm-duty'
import { LLM_MANAGER, LLM_PROVIDER } from '@/core'
import { LLMDuties } from '@/core/llm-manager/types'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import type { MessageLog } from '@/types'

interface SkillRouterLLMDutyParams extends LLMDutyParams {
  history?: MessageLog[]
}

export const SYSTEM_PROMPT = `You are a skill routing AI. Your task is to analyze the User Query and select the single most appropriate skill from the list below based on the user's intent.

Respond using these rules:
- The Available Skills list is the only source of truth.
- Output ONLY an exact skill name copied from the Available Skills list.
- Never output a skill that is not explicitly present in the Available Skills list.
- If the Available Skills list is empty, output ONLY: "None"
- If no listed skill matches the user's intent, output ONLY: "None"
- Do not include any explanations, punctuation, markdown, or extra text.

Available Skills:
{{ SKILL_LIST }}

Carefully evaluate the user's true intent. Prioritize:
- Direct functional match with a listed skill
- Actionability (can this skill fulfill the request?)`

export class SkillRouterLLMDuty extends LLMDuty {
  private static instance: SkillRouterLLMDuty
  protected readonly systemPrompt: LLMDutyParams['systemPrompt'] = null
  protected readonly name = 'Skill Router LLM Duty'
  protected input: LLMDutyParams['input'] = null
  private readonly history: MessageLog[]

  constructor(params: SkillRouterLLMDutyParams) {
    super()

    if (!SkillRouterLLMDuty.instance) {
      LogHelper.title(this.name)
      LogHelper.success('New instance')

      SkillRouterLLMDuty.instance = this
    }

    this.input = params.input
    this.history = params.history || []
    this.systemPrompt = StringHelper.findAndMap(SYSTEM_PROMPT, {
      '{{ SKILL_LIST }}': LLM_MANAGER.skillListContent || ''
    })
  }

  public async init(): Promise<void> {
    return Promise.resolve()
  }

  public async execute(): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    try {
      const prompt = `User Query: "${this.input}"\nChosen Skill Name: `
      const config = LLM_MANAGER.coreLLMDuties[LLMDuties.SkillRouter]
      const completionResult = await LLM_PROVIDER.prompt(prompt, {
        dutyType: LLMDuties.SkillRouter,
        systemPrompt: this.systemPrompt as string,
        history: this.history,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        thoughtTokensBudget: config.thoughtTokensBudget,
        disableThinking: true
      })

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
