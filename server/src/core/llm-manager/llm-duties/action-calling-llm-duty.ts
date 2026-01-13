import {
  type ChatSessionModelFunctions,
  type ChatHistoryItem,
  LlamaChat,
  defineChatSessionFunction
} from 'node-llama-cpp'

import {
  DEFAULT_INIT_PARAMS,
  LLMDuty,
  formatParameterDescription,
  type LLMDutyInitParams,
  type LLMDutyParams,
  type LLMDutyResult
} from '@/core/llm-manager/llm-duty'
import { type SkillSchema } from '@/schemas/skill-schemas'
import { LogHelper } from '@/helpers/log-helper'
import { LLM_MANAGER, LLM_PROVIDER } from '@/core'
import {
  ActionCallingOutput,
  ActionCallingStatus,
  LLMDuties,
  LLMProviders
} from '@/core/llm-manager/types'
import { LLM_PROVIDER as LLM_PROVIDER_NAME } from '@/constants'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

interface ActionCallingLLMDutyParams {
  input: LLMDutyParams['input']
  skillName: string
}

const CHAT_HISTORY_SIZE = 8

export class ActionCallingLLMDuty extends LLMDuty {
  private static instance: ActionCallingLLMDuty
  /**
   * We use LlamaChat to have more control over the session (before function calling)
   * @see https://github.com/withcatai/node-llama-cpp/issues/471
   */
  private static session: LlamaChat = null as unknown as LlamaChat
  private static chatHistory: ChatHistoryItem[] = []
  /**
   * This system prompt is designed to enforce strict rules for function calling with a good balance between
   * context understanding and parameter resolution.
   *
   * E.g. if the owner says "Add apple juice to the list" without any context, it will return a missing parameter.
   * However, if the owner already mentioned the list name in the conversation, it will resolve it correctly.
   * But if the list name is "device" it will be smart enough to not resolve it as "list_name: device" because
   * "apple juice" is not a "device". So it can resolve parameters according to the named entity meaning
   *
   * E.g. "Tonight I want to cook salmon. Please think of the ingredients and add them to the shopping list"
   * "I bought pepper, complete it from the shopping list"
   * // Should understand that it is the "shopping" list, and "rice" is "1kg of rice"
   * "Complete rice, garlic and salt from the list too"
   *
   * Can understand the context data + execute multiple action calls from one single utterance
   * E.g. "Please create a work list, think of all the materials a Software Engineer must have, then and add it to the list"
   * "Do the same for a Butcher but with a new list you must create first"
   *
   * "Create a device list"
   * "Think of the daily common devices we use today and add them to this list"
   */
  protected readonly systemPrompt: LLMDutyParams['systemPrompt'] = `You are a function-calling AI that strictly translates user queries into function call requests. You do not respond conversationally. You do not make assumptions. You do not invent or infer any information.

Follow these rules exactly:

1. NEVER assume or infer a value for any parameter, even if it seems obvious or trivial.
2. If any required parameter is not explicitly provided by the user in their query, DO NOT fill it with a default, guess, or context-based value.
3. Instead, return a JSON object in the following format when parameters are missing:
  \`\`\`json
  {"status": "${ActionCallingStatus.MissingParams}", "required_params": ["param_1", "param_2"], "name": "function_name", "arguments": {"already_provided_param": "value"}}
  \`\`\`
  - \`required_params\`: List all required parameter names that are missing.
  - \`arguments\`: Include only the parameters the user actually provided — do not include missing ones.
4. If the intended function cannot be determined, return:
  \`\`\`json
  {"status": "${ActionCallingStatus.NotFound}"}
  \`\`\`
5. You must ONLY output valid JSON. Never add explanations, greetings, markdown, or any extra text.`
  protected readonly name = 'Action Calling LLM Duty'
  private readonly skillName: string | null = null
  protected input: LLMDutyParams['input'] = null

  constructor(params: ActionCallingLLMDutyParams) {
    super()

    if (!ActionCallingLLMDuty.instance) {
      LogHelper.title(this.name)
      LogHelper.success('New instance')

      ActionCallingLLMDuty.instance = this
    }

    this.input = params.input
    this.skillName = params.skillName
  }

  /**
   * This method parses the optional parameters from the skill configuration
   * and omits them from the required parameters if they are present
   */
  private parseOptionalParameters(
    skillConfig: SkillSchema,
    dutyOutput: ActionCallingOutput
  ): ActionCallingOutput {
    if (dutyOutput.status !== ActionCallingStatus.MissingParams) {
      return dutyOutput
    }

    const actionConfig = skillConfig.actions[dutyOutput.name]
    if (!actionConfig?.optional_parameters) {
      return dutyOutput
    }

    const optionalParams = actionConfig.optional_parameters
    const remainingRequiredParams = dutyOutput.required_params.filter(
      (param: string) => !optionalParams.includes(param)
    )

    if (remainingRequiredParams.length === 0) {
      return {
        status: ActionCallingStatus.Success,
        name: dutyOutput.name,
        /**
         * TODO: handle multi required/optional parameters
         * Because now no matter how many parameters are required and we have optional parameters,
         * it will return an empty object
         */
        arguments: {}
      }
    }

    dutyOutput.required_params = remainingRequiredParams
    return dutyOutput
  }

  /**
   * When there is a flow defined in the skill configuration,
   * only get the first action from the flow.
   * Also merge the other actions
   */
  private filterActionsWithFlow(
    actions: SkillSchema['actions'],
    flow: SkillSchema['flow']
  ): SkillSchema['actions'] {
    if (!flow || !Array.isArray(flow) || flow.length === 0) {
      return actions
    }

    for (const actionName of flow) {
      if (!actionName.includes(':') && !actions[actionName]) {
        LogHelper.error(
          `Action "${actionName}" in the flow is not found. Please verify the skill configuration`
        )
      }
    }

    const filteredActions: SkillSchema['actions'] = {}
    const [firstActionName] = flow
    const firstAction = actions[firstActionName as string]
    if (firstAction) {
      filteredActions[firstActionName as string] = firstAction
    }

    // Merge other actions that are not in the flow
    for (const actionName in actions) {
      const action = actions[actionName]

      if (action && !flow.includes(actionName)) {
        filteredActions[actionName] = action
      }
    }

    return filteredActions
  }

  /**
   * This method converts the action schema from the skill configuration
   * to a function schema that can be used by the LLM provider
   */
  private actionsToFunctionsSchema(
    actions: SkillSchema['actions']
  ): ChatSessionModelFunctions {
    const actionsEntries = Object.entries(actions)
    const functions: ChatSessionModelFunctions = {}

    actionsEntries.forEach(([actionName, action]) => {
      if (!action || !action.type) {
        LogHelper.error(
          `Action "${actionName}" is not valid or does not have a type`
        )
        return
      }

      const { description, parameters } = action
      let functionSchema = {
        description,
        handler: (): void => undefined
      }

      if (parameters) {
        let parsedParameters = {}

        // Browse all parameters to format the description
        Object.entries(parameters).forEach(([paramName, param]) => {
          parsedParameters = {
            ...parsedParameters,
            [paramName]: {
              type: param.type,
              description: formatParameterDescription(param)
            }
          }
        })

        functionSchema = {
          ...functionSchema,
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          params: {
            type: 'object',
            properties: parsedParameters
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      // functions[actionName] = functionSchema
      functions[actionName] = defineChatSessionFunction(functionSchema)
    })

    return functions
  }

  /**
   * Checks pre-LLM inference shortcuts:
   * - If skill only has one action, and it has no parameter, returns LLMDutyResult and skips LLM inference.
   * - If flow exists and the first action needs no parameter, returns LLMDutyResult and skips LLM inference.
   * If none of these apply, returns true to continue with LLM inference.
   */
  private handlePreLLMInference(
    actions: SkillSchema['actions'],
    flow: SkillSchema['flow']
  ): LLMDutyResult | true {
    // Single action, no parameters
    const actionNames = Object.keys(actions)
    if (actionNames.length === 1) {
      const [singleActionName] = actionNames
      const singleAction = actions[singleActionName as string]
      const hasParameters =
        singleAction?.parameters &&
        Object.keys(singleAction.parameters).length > 0

      if (!hasParameters) {
        // Directly return this single action as success, no arguments needed
        return {
          output: JSON.stringify([
            {
              status: ActionCallingStatus.Success,
              name: singleActionName,
              arguments: {}
            }
          ]),
          usedInputTokens: 0,
          usedOutputTokens: 0
        } as unknown as LLMDutyResult
      }
    }

    // Flow first action, no parameters
    if (flow && Array.isArray(flow) && flow.length > 0) {
      const [firstActionName] = flow
      const firstAction = actions[firstActionName as string]

      if (firstAction) {
        const hasParameters =
          firstAction.parameters &&
          Object.keys(firstAction.parameters).length > 0
        if (!hasParameters) {
          return {
            output: JSON.stringify([
              {
                status: ActionCallingStatus.Success,
                name: firstActionName,
                arguments: {}
              }
            ]),
            usedInputTokens: 0,
            usedOutputTokens: 0
          } as unknown as LLMDutyResult
        }
      }
    }

    // None apply: continue with LLM inference
    return true
  }

  public async init(
    params: LLMDutyInitParams = DEFAULT_INIT_PARAMS
  ): Promise<void> {
    if (LLM_PROVIDER_NAME === LLMProviders.Local) {
      if (!ActionCallingLLMDuty.session || params.force) {
        LogHelper.title(this.name)
        LogHelper.info('Initializing...')

        try {
          /**
           * Dispose the previous session and sequence
           * to give space for the new one
           */
          if (params.force) {
            ActionCallingLLMDuty.session.dispose({ disposeSequence: true })
            LogHelper.info('Session disposed')
          }

          /**
           * We use LlamaChat to have more control over the session (before function calling)
           * @see https://github.com/withcatai/node-llama-cpp/issues/471
           */
          ActionCallingLLMDuty.session = new LlamaChat({
            contextSequence: LLM_MANAGER.context.getSequence(),
            autoDisposeSequence: true
          })

          ActionCallingLLMDuty.chatHistory =
            ActionCallingLLMDuty.session.chatWrapper.generateInitialChatHistory(
              {
                systemPrompt: this.systemPrompt as string
              }
            )

          LogHelper.info(
            `System prompt size: ${
              LLM_MANAGER.model.tokenize(this.systemPrompt as string).length
            }`
          )
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
      const skillConfig = await SkillDomainHelper.getNewSkillConfig(
        this.skillName as string
      )
      const {
        action_notes: actionNotes = [],
        actions,
        flow
      } = skillConfig || {}

      if (!actions || Object.keys(actions).length === 0) {
        LogHelper.title(this.name)
        LogHelper.error(
          `No actions found in the "${this.skillName}" skill configuration`
        )

        return null
      }

      // Call pre-LLM shortcuts
      const maybeResult = this.handlePreLLMInference(actions, flow)
      if (maybeResult !== true) {
        LogHelper.title(this.name)
        LogHelper.success('Duty executed (pre-inference LLM shortcut hit)')
        LogHelper.success(`Output — ${(maybeResult as LLMDutyResult).output}`)

        return maybeResult as LLMDutyResult
      }
      let prompt = `User Query: "${this.input}"`

      if (actionNotes.length > 0) {
        prompt = `You must pay attention to these notes: ${actionNotes.join(
          '; '
        )}\n${prompt}`
      }

      ActionCallingLLMDuty.chatHistory.push({
        type: 'user',
        text: prompt
      })
      ActionCallingLLMDuty.chatHistory.push({
        type: 'model',
        response: []
      })

      const filteredActions = this.filterActionsWithFlow(actions, flow)
      const functionsSchema = this.actionsToFunctionsSchema(filteredActions)
      const config = LLM_MANAGER.coreLLMDuties[LLMDuties.ActionCalling]
      const completionParams = {
        functions: functionsSchema,
        dutyType: LLMDuties.ActionCalling,
        systemPrompt: this.systemPrompt as string,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        thoughtTokensBudget: config.thoughtTokensBudget
      }
      const dutyOutput: ActionCallingOutput[] = []
      let completionResult

      if (LLM_PROVIDER_NAME === LLMProviders.Local) {
        completionResult = await LLM_PROVIDER.prompt(
          ActionCallingLLMDuty.chatHistory,
          {
            ...completionParams,
            session: ActionCallingLLMDuty.session
          }
        )

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = completionResult?.output as any

        // Reset chat history to the last 8 messages
        ActionCallingLLMDuty.chatHistory =
          response.lastEvaluation.cleanHistory.slice(-CHAT_HISTORY_SIZE)

        /**
         * The model decided to call a function/several functions
         */
        if (response.functionCalls && response.functionCalls.length > 0) {
          for (const call of response.functionCalls) {
            const functionName = call.functionName
            const params = call.params
            const functionDefinition = functionsSchema[functionName]
            let actionOutput: ActionCallingOutput | null = null

            if (!functionDefinition) {
              actionOutput = {
                status: ActionCallingStatus.NotFound
              }
            } else {
              /**
               * Check if the parameters are provided
               */

              const requiredParams = functionDefinition?.params?.required || []
              const missingParams = requiredParams.filter(
                (required: string) => params[required] == null
              )

              if (missingParams.length > 0) {
                actionOutput = {
                  status: ActionCallingStatus.MissingParams,
                  required_params: missingParams,
                  name: functionName,
                  arguments: params
                }
              } else {
                actionOutput = {
                  status: ActionCallingStatus.Success,
                  name: functionName,
                  arguments: params
                }
              }
            }

            if (actionOutput) {
              const finalActionOutput = this.parseOptionalParameters(
                skillConfig as SkillSchema,
                actionOutput
              )

              dutyOutput.push(finalActionOutput)
            }
          }
        } else {
          LogHelper.title(this.name)
          LogHelper.warning(
            'The duty did not call a function, trying manual parsing...'
          )

          /**
           * The model did not call a function, hence we need to parse the response manually
           */
          try {
            // In case it returned a JSON object
            const tmpResponse = JSON.parse(response.response)
            let parsedOutput: ActionCallingOutput | null = null

            if (tmpResponse.status) {
              if (tmpResponse.status === ActionCallingStatus.MissingParams) {
                parsedOutput = {
                  status: ActionCallingStatus.MissingParams,
                  required_params: tmpResponse.required_params || [],
                  name: tmpResponse.name || '',
                  arguments: tmpResponse.arguments || {}
                }
              } else if (tmpResponse.status === ActionCallingStatus.NotFound) {
                parsedOutput = {
                  status: ActionCallingStatus.NotFound
                }
              }
            } else if (tmpResponse.name) {
              parsedOutput = {
                status: ActionCallingStatus.Success,
                name: tmpResponse.name,
                arguments: tmpResponse.arguments || {}
              }
            } else {
              parsedOutput = {
                status: ActionCallingStatus.NotFound
              }
            }

            if (parsedOutput) {
              dutyOutput.push(
                this.parseOptionalParameters(
                  skillConfig as SkillSchema,
                  parsedOutput
                )
              )
            }
          } catch {
            dutyOutput.push({
              status: ActionCallingStatus.NotFound
            })
          }
        }
      } else {
        completionResult = await LLM_PROVIDER.prompt(prompt, completionParams)
      }

      if (dutyOutput.length === 0) {
        dutyOutput.push({ status: ActionCallingStatus.NotFound })
      }

      if (completionResult) {
        completionResult.output = JSON.stringify(dutyOutput)
      }

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
