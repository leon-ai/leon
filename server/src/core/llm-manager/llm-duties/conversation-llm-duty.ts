import type { LlamaContext, LlamaChatSession } from 'node-llama-cpp'

import type { MessageLog } from '@/types'
import {
  type LLMDutyParams,
  type LLMDutyResult,
  type LLMDutyInitParams,
  type LLMDutyExecuteParams,
  LLMDuty,
  DEFAULT_INIT_PARAMS,
  DEFAULT_EXECUTE_PARAMS
} from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'
import {
  LLM_MANAGER,
  PERSONA,
  NLU,
  LOOP_CONVERSATION_LOGGER,
  CONVERSATION_LOGGER,
  LLM_PROVIDER,
  SOCKET_SERVER,
  EVENT_EMITTER
} from '@/core'
import { LLMProviders, LLMDuties } from '@/core/llm-manager/types'
import { LLM_PROVIDER as LLM_PROVIDER_NAME } from '@/constants'
import { StringHelper } from '@/helpers/string-helper'

export class ConversationLLMDuty extends LLMDuty {
  private static instance: ConversationLLMDuty
  private static context: LlamaContext = null as unknown as LlamaContext
  private static session: LlamaChatSession = null as unknown as LlamaChatSession
  private static messagesHistoryForNonLocalProvider: MessageLog[] =
    null as unknown as MessageLog[]
  protected systemPrompt = ''
  protected readonly name = 'Conversation LLM Duty'
  protected input: LLMDutyParams['input'] = null

  constructor() {
    super()

    if (!ConversationLLMDuty.instance) {
      LogHelper.title(this.name)
      LogHelper.success('New instance')

      ConversationLLMDuty.instance = this

      EVENT_EMITTER.on('persona_new-mood-set', async () => {
        await this.init({ force: true })
      })
      EVENT_EMITTER.on('persona_new-info-set', async () => {
        await this.init({ force: true })
      })
    }
  }

  public async init(
    params: LLMDutyInitParams = DEFAULT_INIT_PARAMS
  ): Promise<void> {
    LogHelper.title(this.name)
    LogHelper.info('Initializing...')

    try {
      params.useLoopHistory = params.useLoopHistory ?? true

      if (LLM_PROVIDER_NAME === LLMProviders.Local) {
        /**
         * A new context and session will be created only
         * when Leon's instance is restarted or when it is forced
         */
        if (
          !ConversationLLMDuty.context ||
          !ConversationLLMDuty.session ||
          params.force
        ) {
          await LOOP_CONVERSATION_LOGGER.clear()

          if (params.force) {
            if (ConversationLLMDuty.context) {
              await ConversationLLMDuty.context.dispose()
            }
            if (ConversationLLMDuty.session) {
              ConversationLLMDuty.session.dispose({ disposeSequence: true })
            }
          }

          ConversationLLMDuty.context = await LLM_MANAGER.model.createContext()

          const { LlamaChatSession } = await Function(
            'return import("node-llama-cpp")'
          )()

          this.systemPrompt = PERSONA.getConversationSystemPrompt()

          ConversationLLMDuty.session = new LlamaChatSession({
            contextSequence: ConversationLLMDuty.context.getSequence(),
            autoDisposeSequence: true,
            systemPrompt: this.systemPrompt
          }) as LlamaChatSession
        } else {
          let conversationLogger = LOOP_CONVERSATION_LOGGER

          if (!params.useLoopHistory) {
            conversationLogger = CONVERSATION_LOGGER
          }

          /**
           * As long as Leon's instance has not been restarted,
           * the context, session with history will be loaded
           */
          const history = await LLM_MANAGER.loadHistory(
            conversationLogger,
            ConversationLLMDuty.session
          )

          ConversationLLMDuty.session.setChatHistory(history)
        }
      } else {
        /**
         * For non-local providers:
         * Once Leon's instance is restarted, clean up the messages history,
         * then load the messages history
         */

        if (!ConversationLLMDuty.messagesHistoryForNonLocalProvider) {
          await LOOP_CONVERSATION_LOGGER.clear()
        }

        let conversationLogger = LOOP_CONVERSATION_LOGGER

        if (!params.useLoopHistory) {
          conversationLogger = CONVERSATION_LOGGER
        }

        ConversationLLMDuty.messagesHistoryForNonLocalProvider =
          await conversationLogger.load()
      }

      LogHelper.success('Initialized')
    } catch (e) {
      LogHelper.title(this.name)
      LogHelper.error(`Failed to initialize: ${e}`)
    }
  }

  public async execute(
    params: LLMDutyExecuteParams = DEFAULT_EXECUTE_PARAMS
  ): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    try {
      await LOOP_CONVERSATION_LOGGER.push({
        who: 'owner',
        message: NLU.nluResult.newUtterance
      })

      const prompt = NLU.nluResult.newUtterance
      const completionParams = {
        dutyType: LLMDuties.Conversation,
        systemPrompt: this.systemPrompt,
        temperature: 1.3
      }
      let completionResult

      if (LLM_PROVIDER_NAME === LLMProviders.Local) {
        const generationId = StringHelper.random(6, { onlyLetters: true })
        completionResult = await LLM_PROVIDER.prompt(prompt, {
          ...completionParams,
          session: ConversationLLMDuty.session,
          maxTokens: ConversationLLMDuty.context.contextSize,
          onToken: (chunk) => {
            if (!params.isWarmingUp) {
              const detokenizedChunk = LLM_PROVIDER.cleanUpResult(
                LLM_MANAGER.model.detokenize(chunk)
              )

              SOCKET_SERVER.socket?.emit('llm-token', {
                token: detokenizedChunk,
                generationId
              })
            }
          }
        })
      } else {
        completionResult = await LLM_PROVIDER.prompt(prompt, {
          ...completionParams,
          history: ConversationLLMDuty.messagesHistoryForNonLocalProvider
        })
      }

      await LOOP_CONVERSATION_LOGGER.push({
        who: 'leon',
        message: completionResult?.output as string
      })

      LogHelper.title(this.name)
      LogHelper.success('Duty executed')
      LogHelper.success(`Prompt — ${prompt}`)
      LogHelper.success(`Output — ${completionResult?.output}
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
