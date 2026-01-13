import { type ChatHistoryItem, LlamaChatSession } from 'node-llama-cpp'

import {
  DEFAULT_EXECUTE_PARAMS,
  DEFAULT_INIT_PARAMS,
  formatParameterDescription,
  LLMDuty,
  type LLMDutyExecuteParams,
  type LLMDutyInitParams,
  type LLMDutyParams,
  type LLMDutyResult
} from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'
import { LLM_MANAGER, LLM_PROVIDER, CONVERSATION_LOGGER } from '@/core'
import {
  LLMDuties,
  LLMProviders,
  SlotFillingStatus
} from '@/core/llm-manager/types'
import { LLM_PROVIDER as LLM_PROVIDER_NAME } from '@/constants'

interface SlotFillingLLMDutyParams {
  input: {
    slotName: string
    slotDescription: string
    slotType: string
  } | null
  startingUtterance: string
}

const SYSTEM_PROMPT = `You are a highly specialized linguistic model called 'Slot Filling'. Your sole purpose is to extract specific pieces of information ('slots') from a user's latest response. You will be given the conversation history and a list of the specific slots you need to find.

You must adhere to the following rules:

1. Analyze the LATEST user message in the context of the conversation.
2. Only look for the slots you are told to find. Ignore any other information or intents.
3. Do not invent or infer information. If the user says "the big apple," you can extract "the big apple" but not "New York City" unless the tool definition allows it.
4. Your entire output MUST be a single JSON object with one of two possible statuses:

A. If you successfully find one or more requested slots:
  \`\`\`json
  {"filled_slots": { "<slot_name_1>": "<extracted_value_1>", "<slot_name_2>": "<extracted_value_2>" }}
  \`\`\`

B. If the user's response does NOT contain any of the requested slots:
  \`\`\`json
  {"status": "${SlotFillingStatus.NotFound}"}
  \`\`\`

CRITICAL RULE: Do not output any other text, explanations, or conversational filler. Your response must be pure JSON, adhering strictly to the formats above.`
const WARM_UP_HISTORY: ChatHistoryItem[] = [
  {
    type: 'system',
    text: SYSTEM_PROMPT
  },
  {
    type: 'user',
    text: 'Hello there'
  },
  {
    type: 'model',
    response: ['Hi, great to see you here!']
  },
  {
    type: 'user',
    text: 'I want to go somewhere'
  },
  {
    type: 'model',
    response: ['Please provide the location.']
  },
  {
    type: 'user',
    text: 'I want to go to Shenzhen'
  }
]

export class SlotFillingLLMDuty extends LLMDuty {
  private static instance: SlotFillingLLMDuty
  private static session: LlamaChatSession = null as unknown as LlamaChatSession
  private readonly startingUtterance: string | null = null
  protected readonly systemPrompt: LLMDutyParams['systemPrompt'] = null
  protected readonly name = 'Slot Filling LLM Duty'
  protected input: SlotFillingLLMDutyParams['input'] = null

  constructor(params: SlotFillingLLMDutyParams) {
    super()

    if (!SlotFillingLLMDuty.instance) {
      LogHelper.title(this.name)
      LogHelper.success('New instance')

      SlotFillingLLMDuty.instance = this
    }

    this.input = params.input
    this.startingUtterance = params.startingUtterance

    this.systemPrompt = SYSTEM_PROMPT
  }

  public async init(
    params: LLMDutyInitParams = DEFAULT_INIT_PARAMS
  ): Promise<void> {
    if (LLM_PROVIDER_NAME === LLMProviders.Local) {
      if (!SlotFillingLLMDuty.session || params.force) {
        LogHelper.title(this.name)
        LogHelper.info('Initializing...')

        try {
          /**
           * Dispose the previous session and sequence
           * to give space for the new one
           */
          if (params.force) {
            SlotFillingLLMDuty.session.dispose({ disposeSequence: true })
            LogHelper.info('Session disposed')
          }

          SlotFillingLLMDuty.session = new LlamaChatSession({
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

  public async execute(
    params: LLMDutyExecuteParams = DEFAULT_EXECUTE_PARAMS
  ): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    if (this.input?.slotType && this.input?.slotDescription) {
      this.input.slotDescription = formatParameterDescription({
        type: this.input?.slotType as string,
        description: this.input?.slotDescription as string
      })
    }

    try {
      const prompt = `INSTRUCTIONS:
Analyze the last user message to find the following slot:
- Slot name: "${this.input?.slotName}"
- Slot description: "${this.input?.slotDescription}"`
      const config = LLM_MANAGER.coreLLMDuties[LLMDuties.SlotFilling]
      const completionParams = {
        dutyType: LLMDuties.SlotFilling,
        systemPrompt: this.systemPrompt as string,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        thoughtTokensBudget: config.thoughtTokensBudget
      }
      let completionResult

      if (LLM_PROVIDER_NAME === LLMProviders.Local) {
        /**
         * Load the relevant history from the conversation logger.
         * We only need the messages that are saved after the starting utterance
         */
        const history = params.isWarmingUp
          ? WARM_UP_HISTORY
          : await LLM_MANAGER.loadHistory(
              CONVERSATION_LOGGER,
              SlotFillingLLMDuty.session,
              { nbOfLogsToLoad: 8 }
            )
        const [systemPrompt] = history
        const startIndex = history.findLastIndex(
          (message: ChatHistoryItem) =>
            message.type === 'user' && message.text === this.startingUtterance
        )
        let relevantHistory = [systemPrompt, ...history]
        if (startIndex > 0 && systemPrompt) {
          relevantHistory = history.slice(startIndex)
          relevantHistory = [systemPrompt, ...relevantHistory]
        }

        /**
         * Setting history can be useful to load messages from the conversation
         * when starting a new session
         */
        SlotFillingLLMDuty.session.setChatHistory(
          relevantHistory as ChatHistoryItem[]
        )

        completionResult = await LLM_PROVIDER.prompt(prompt, {
          ...completionParams,
          session: SlotFillingLLMDuty.session
        })
      } else {
        completionResult = await LLM_PROVIDER.prompt(prompt, completionParams)
      }

      if (completionResult?.output) {
        const parsedResult = JSON.parse(completionResult.output)
        const { filled_slots: filledSlots } = parsedResult

        if (filledSlots) {
          completionResult.output = {
            status: SlotFillingStatus.Success,
            ...parsedResult
          }
        } else if (typeof completionResult?.output === 'string') {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          completionResult.output = {
            status: SlotFillingStatus.NotFound
          }
        }
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
