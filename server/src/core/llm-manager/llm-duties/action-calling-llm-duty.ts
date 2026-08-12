import {
  LLMDuty,
  formatParameterDescription,
  type LLMDutyParams,
  type LLMDutyResult
} from '@/core/llm-manager/llm-duty'
import { LLM_MANAGER, LLM_PROVIDER } from '@/core'
import {
  ActionCallingStatus,
  type ActionCallingOutput,
  LLMDuties,
  type OpenAITool
} from '@/core/llm-manager/types'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { LogHelper } from '@/helpers/log-helper'
import type { MessageLog } from '@/types'

interface ActionCallingWorkflowContext {
  recentUtterances: string[]
  recentActionArguments: Record<string, unknown>[]
  collectedParameters: Record<string, unknown>
  recentEntities: Record<string, unknown>[]
}

interface ActionCallingLLMDutyParams {
  input: LLMDutyParams['input']
  skillName: string
  workflowContext?: ActionCallingWorkflowContext
  history?: MessageLog[]
}

interface ActionCallingToolCall {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
}

interface OpenAIJSONSchema {
  type?: string
  description?: string
  enum?: string[]
  properties?: Record<string, OpenAIJSONSchema>
  required?: string[]
  items?: OpenAIJSONSchema
  additionalProperties?: boolean
}

interface ActionToolConfig {
  type?: string
  description?: string
  parameters?: Record<string, unknown>
  optional_parameters?: string[]
}

type ActionToolConfigs = Record<string, ActionToolConfig | undefined>

interface ActionCallingSkillConfig {
  action_notes?: string[]
  actions: ActionToolConfigs
  workflow?: string[]
}

export class ActionCallingLLMDuty extends LLMDuty {
  private static instance: ActionCallingLLMDuty
  protected readonly systemPrompt: LLMDutyParams['systemPrompt'] = `You are a function-calling AI that translates user requests into Leon action calls.

You may resolve required parameters from two sources only:
1. The current user query.
2. The provided workflow context from the same active Leon skill workflow.

Rules:
1. Only use values that are directly grounded in the query or the provided workflow context.
2. Do not invent, guess, or broaden a value beyond what the query or context supports.
3. If the context is ambiguous, conflicting, or insufficient, return missing parameters instead of forcing a value.
4. If the intended function cannot be determined, return:
{"status":"${ActionCallingStatus.NotFound}"}
5. When required parameters are missing, return:
{"status":"${ActionCallingStatus.MissingParams}","required_params":["param_1"],"name":"function_name","arguments":{"known_param":"value"}}
6. You must ONLY output valid JSON or tool calls. Never add explanations, markdown, or extra text.`
  protected readonly name = 'Action Calling LLM Duty'
  private readonly skillName: string
  private readonly workflowContext: ActionCallingWorkflowContext | null
  private readonly history: MessageLog[]
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
    this.workflowContext = params.workflowContext || null
    this.history = params.history || []
  }

  private parseOptionalParameters(
    actions: ActionToolConfigs,
    dutyOutput: ActionCallingOutput
  ): ActionCallingOutput {
    if (dutyOutput.status !== ActionCallingStatus.MissingParams) {
      return dutyOutput
    }

    const actionConfig = actions[dutyOutput.name]
    if (!actionConfig?.optional_parameters) {
      return dutyOutput
    }

    const remainingRequiredParams = dutyOutput.required_params.filter(
      (paramName) => !actionConfig.optional_parameters?.includes(paramName)
    )

    if (remainingRequiredParams.length === 0) {
      return {
        status: ActionCallingStatus.Success,
        name: dutyOutput.name,
        arguments: dutyOutput.arguments as Record<string, unknown>
      }
    }

    return {
      ...dutyOutput,
      required_params: remainingRequiredParams
    }
  }

  private filterActionsWithWorkflow(
    actions: ActionToolConfigs,
    workflow: string[] | undefined
  ): ActionToolConfigs {
    if (!workflow || !Array.isArray(workflow) || workflow.length === 0) {
      return actions
    }

    const filteredActions: ActionToolConfigs = {}
    const [firstActionName] = workflow
    const firstAction = actions[firstActionName as string]

    if (firstAction) {
      filteredActions[firstActionName as string] = firstAction
    }

    for (const actionName in actions) {
      if (actions[actionName] && !workflow.includes(actionName)) {
        filteredActions[actionName] = actions[actionName]
      }
    }

    return filteredActions
  }

  private actionsToOpenAITools(actions: ActionToolConfigs): OpenAITool[] {
    const tools: OpenAITool[] = []
    // The generated skill schema is recursively typed. Only these action
    // fields are needed here, so keep TypeScript from expanding the full tree.
    const actionEntries = Object.entries(actions)

    for (const [actionName, action] of actionEntries) {
      if (!action || !action.type) {
        continue
      }

      const properties: Record<string, OpenAIJSONSchema> = {}
      const required: string[] = []

      if (action.parameters) {
        for (const [paramName, param] of Object.entries(action.parameters)) {
          properties[paramName] = this.toOpenAIParameterSchema(param)

          if (!action.optional_parameters?.includes(paramName)) {
            required.push(paramName)
          }
        }
      }

      tools.push({
        type: 'function',
        function: {
          name: actionName,
          description: action.description || '',
          parameters: {
            type: 'object',
            properties,
            additionalProperties: false,
            ...(required.length > 0 ? { required } : {})
          }
        }
      })
    }

    return tools
  }

  private handlePreLLMInference(
    actions: ActionToolConfigs,
    workflow: string[] | undefined
  ): LLMDutyResult | true {
    const actionNames = Object.keys(actions)

    if (actionNames.length === 1) {
      const [singleActionName] = actionNames
      const singleAction = actions[singleActionName as string]
      const hasParameters =
        !!singleAction?.parameters &&
        Object.keys(singleAction.parameters).length > 0

      if (!hasParameters) {
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

    if (workflow && Array.isArray(workflow) && workflow.length > 0) {
      const [firstActionName] = workflow
      const firstAction = actions[firstActionName as string]
      const hasParameters =
        !!firstAction?.parameters && Object.keys(firstAction.parameters).length > 0

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

    return true
  }

  private toOpenAIParameterSchema(param: unknown): OpenAIJSONSchema {
    if (!param || typeof param !== 'object' || !('type' in param)) {
      return {
        type: 'string'
      }
    }

    const typedParam = param as Record<string, unknown>
    const description =
      typeof typedParam['description'] === 'string'
        ? formatParameterDescription({
            type: String(typedParam['type']),
            description: typedParam['description']
          })
        : undefined

    if (typedParam['type'] === 'object') {
      const rawProperties =
        typeof typedParam['properties'] === 'object' &&
        typedParam['properties'] !== null
          ? (typedParam['properties'] as Record<string, unknown>)
          : {}
      const properties: Record<string, OpenAIJSONSchema> = {}
      const required = Object.keys(rawProperties)

      for (const [propertyName, propertySchema] of Object.entries(rawProperties)) {
        properties[propertyName] = this.toOpenAIParameterSchema(propertySchema)
      }

      return {
        type: 'object',
        ...(description ? { description } : {}),
        properties,
        additionalProperties: false,
        ...(required.length > 0 ? { required } : {})
      }
    }

    if (typedParam['type'] === 'array') {
      return {
        type: 'array',
        ...(description ? { description } : {}),
        items: this.toOpenAIParameterSchema(typedParam['items'])
      }
    }

    if (
      typedParam['type'] === 'string' &&
      Array.isArray(typedParam['enum']) &&
      typedParam['enum'].every((item) => typeof item === 'string')
    ) {
      return {
        type: 'string',
        ...(description ? { description } : {}),
        enum: typedParam['enum'] as string[]
      }
    }

    return {
      type: String(typedParam['type']),
      ...(description ? { description } : {})
    }
  }

  private buildPrompt(
    actionNotes: string[],
    preselectedSingleActionName: string | null
  ): string {
    const promptLines = [
      'Workflow context (JSON):',
      JSON.stringify(this.workflowContext || {}, null, 2),
      '',
      `User Query: "${this.input}"`
    ]

    if (preselectedSingleActionName) {
      promptLines.unshift(
        `Only one action exists for this skill: "${preselectedSingleActionName}". Use that action and resolve its parameters.`
      )
    }

    if (actionNotes.length > 0) {
      promptLines.unshift(`Action notes: ${actionNotes.join('; ')}`)
    }

    return promptLines.join('\n')
  }

  private toMissingParamsOutput(
    functionName: string,
    params: Record<string, unknown>,
    actionConfig: ActionToolConfig
  ): ActionCallingOutput {
    const requiredParams = Object.keys(actionConfig.parameters || {}).filter(
      (paramName) => !actionConfig.optional_parameters?.includes(paramName)
    )
    const missingParams = requiredParams.filter(
      (requiredParam) => params[requiredParam] == null
    )

    return missingParams.length > 0
      ? {
          status: ActionCallingStatus.MissingParams,
          required_params: missingParams,
          name: functionName,
          arguments: params
        }
      : {
          status: ActionCallingStatus.Success,
          name: functionName,
          arguments: params
        }
  }

  /** Normalize provider output against the declared action parameter schema. */
  private normalizeActionOutput(
    functionName: string,
    rawParams: unknown,
    actions: ActionToolConfigs
  ): ActionCallingOutput {
    const actionConfig = actions[functionName]

    if (!actionConfig) {
      return { status: ActionCallingStatus.NotFound }
    }

    const providedParams =
      rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
        ? (rawParams as Record<string, unknown>)
        : {}
    const declaredParamNames = new Set(
      Object.keys(actionConfig.parameters || {})
    )
    const params = Object.fromEntries(
      Object.entries(providedParams).filter(([paramName]) =>
        declaredParamNames.has(paramName)
      )
    )

    return this.toMissingParamsOutput(functionName, params, actionConfig)
  }

  public async init(): Promise<void> {
    return Promise.resolve()
  }

  public async execute(): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    try {
      const skillConfig = await SkillDomainHelper.getNewSkillConfig(
        this.skillName
      ) as unknown as ActionCallingSkillConfig | null
      const {
        action_notes: actionNotes = [],
        actions,
        workflow
      } = skillConfig || {}

      if (!skillConfig || !actions || Object.keys(actions).length === 0) {
        LogHelper.title(this.name)
        LogHelper.error(
          `No actions found in the "${this.skillName}" skill configuration`
        )

        return null
      }

      const actionNames = Object.keys(actions)
      const preselectedSingleActionName =
        actionNames.length === 1 ? (actionNames[0] as string) : null
      const maybeResult = this.handlePreLLMInference(actions, workflow)

      if (maybeResult !== true) {
        LogHelper.title(this.name)
        LogHelper.success('Duty executed (pre-inference shortcut hit)')
        LogHelper.success(`Output — ${(maybeResult as LLMDutyResult).output}`)

        return maybeResult as LLMDutyResult
      }

      const prompt = this.buildPrompt(actionNotes, preselectedSingleActionName)
      const filteredActions = this.filterActionsWithWorkflow(actions, workflow)
      const openAITools = this.actionsToOpenAITools(filteredActions)
      const config = LLM_MANAGER.coreLLMDuties[LLMDuties.ActionCalling]
      const completionResult = await LLM_PROVIDER.prompt(prompt, {
        dutyType: LLMDuties.ActionCalling,
        systemPrompt: this.systemPrompt as string,
        history: this.history,
        temperature: config.temperature,
        seed: config.seed,
        maxTokens: config.maxTokens,
        thoughtTokensBudget: config.thoughtTokensBudget,
        disableThinking: true,
        tools: openAITools,
        toolChoice: 'auto'
      })

      if (!completionResult) {
        return null
      }

      const dutyOutput: ActionCallingOutput[] = []
      const toolCalls = (completionResult as { toolCalls?: ActionCallingToolCall[] })
        .toolCalls

      if (toolCalls && toolCalls.length > 0) {
        for (const call of toolCalls) {
          const functionName = call.function.name
          let params: Record<string, unknown> = {}

          try {
            params = JSON.parse(call.function.arguments)
          } catch {
            params = {}
          }

          const actionOutput = this.normalizeActionOutput(
            functionName,
            params,
            filteredActions
          )

          dutyOutput.push(
            this.parseOptionalParameters(actions, actionOutput)
          )
        }
      } else {
        LogHelper.title(this.name)
        LogHelper.warning(
          'Provider did not return tool calls, trying manual JSON parsing...'
        )

        try {
          const rawOutput =
            typeof completionResult.output === 'string'
              ? completionResult.output
              : JSON.stringify(completionResult.output)
          const parsedResponse = JSON.parse(rawOutput)
          const tmpResponse = Array.isArray(parsedResponse)
            ? parsedResponse[0]
            : parsedResponse
          let parsedOutput: ActionCallingOutput = {
            status: ActionCallingStatus.NotFound
          }

          if (
            tmpResponse?.status !== ActionCallingStatus.NotFound &&
            tmpResponse?.name
          ) {
            parsedOutput = this.normalizeActionOutput(
              tmpResponse.name,
              tmpResponse.arguments,
              filteredActions
            )
          }

          dutyOutput.push(
            this.parseOptionalParameters(actions, parsedOutput)
          )
        } catch {
          dutyOutput.push({
            status: ActionCallingStatus.NotFound
          })
        }
      }

      if (dutyOutput.length === 0) {
        dutyOutput.push({ status: ActionCallingStatus.NotFound })
      }

      completionResult.output = JSON.stringify(dutyOutput)

      LogHelper.title(this.name)
      LogHelper.success('Duty executed')
      LogHelper.success(`Prompt — ${prompt}`)
      LogHelper.success(`Output — ${completionResult.output}
usedInputTokens: ${completionResult.usedInputTokens}
usedOutputTokens: ${completionResult.usedOutputTokens}`)

      return completionResult as unknown as LLMDutyResult
    } catch (e) {
      LogHelper.title(this.name)
      LogHelper.error(`Failed to execute: ${e}`)
    }

    return null
  }
}
