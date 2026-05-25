import { LogHelper } from '@/helpers/log-helper'
import { LLMProviders, type OpenAITool } from '@/core/llm-manager/types'
import type { MessageLog } from '@/types'
import { CONFIG_STATE } from '@/core/config-states/config-state'

import {
  PLAN_SYSTEM_PROMPT,
  DUTY_NAME,
  READ_TOOL_ARTIFACT_FUNCTION
} from './constants'
import type {
  Catalog,
  LLMCaller,
  PlanResult,
  PromptLogSection,
  FinalPhaseIntent
} from './types'
import {
  extractPlanFromParsed,
  parseOutput,
  parseToolCallArguments,
  extractPlanResultFromCreatePlanArgs
} from './utils'
import {
  shouldTreatPlanningTextAsFinalAnswer,
  shouldTreatPlainPlanningTextAsFinalAnswer,
  extractPlanningMarkedFinalAnswer,
  extractPlanningTextHandoffDraft,
  createPlanFromUnexpectedToolCall,
  buildContextManifestSection,
  buildSelfModelSection,
  buildActiveAgentSkillSection,
  buildAgentSkillDiscoverySection
} from './phase-helpers'
import {
  PLAN_RESPONSE_SCHEMA,
  PLAN_STEP_SCHEMA
} from './plan-contract'
import { buildPhaseSystemPrompt } from './phase-policy'

function getLLMProviderName(): LLMProviders {
  const provider = CONFIG_STATE.getModelState().getAgentProvider()

  if (!provider) {
    throw new Error('The agent LLM provider is disabled.')
  }

  return provider
}

function buildPlanningPromptSections(params: {
  prompt: string
  systemPrompt: string
  includeTools?: boolean
  includeSchema?: boolean
  schemaOverride?: Record<string, unknown>
  tools?: OpenAITool[]
}): PromptLogSection[] {
  const sections: PromptLogSection[] = [
    {
      name: 'SYSTEM_PROMPT_FULL',
      source: 'server/src/core/llm-manager/persona.ts',
      content: params.systemPrompt
    },
    {
      name: 'BASE_SYSTEM_PROMPT',
      source: 'server/src/core/llm-manager/llm-duties/react-llm-duty/constants.ts',
      content: PLAN_SYSTEM_PROMPT
    },
    {
      name: 'PLANNING_INPUT',
      source: 'server/src/core/llm-manager/llm-duties/react-llm-duty/planning.ts',
      content: params.prompt
    }
  ]

  if (params.includeTools && params.tools) {
    sections.push({
      name: 'TOOLS_SCHEMA',
      source:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/planning.ts',
      content: JSON.stringify(params.tools)
    })
  }

  if (params.includeSchema) {
    sections.push({
      name: 'PLAN_SCHEMA',
      source:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/plan-contract.ts',
      content: JSON.stringify(params.schemaOverride || PLAN_RESPONSE_SCHEMA)
    })
  }

  return sections
}

function isOperatingSystemControlOnlyPlan(steps: { function: string }[]): boolean {
  if (steps.length === 0) {
    return false
  }

  return steps.every((step) =>
    step.function.startsWith('operating_system_control.')
  )
}

function createPlanningHandoff(
  draft: string,
  intent: FinalPhaseIntent = 'answer'
): PlanResult {
  return {
    type: 'handoff',
    signal: {
      intent,
      draft,
      source: 'planning'
    }
  }
}

function shouldAttemptForcedPlanFallback(planResult: PlanResult): boolean {
  return (
    planResult.type === 'handoff' &&
    planResult.signal.intent === 'answer'
  )
}

function extractCatalogFunctionNames(catalog: Catalog): string[] {
  const functionNames: string[] = []

  for (const line of catalog.text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) {
      continue
    }

    const body = trimmed.slice(2).trim()
    const nameEndIndex = body.indexOf(' ')
    const functionName =
      nameEndIndex === -1 ? body : body.slice(0, nameEndIndex)

    if (
      functionName.includes('.') &&
      !functionNames.includes(functionName)
    ) {
      functionNames.push(functionName)
    }
  }

  return functionNames
}

function buildRecoveredPlanStepLabel(functionName: string): string {
  const lastSegment = functionName.split('.').at(-1) || 'tool'
  return `Run ${lastSegment}`
}

function recoverPlanFromFunctionMentions(
  rawText: string,
  catalog: Catalog
): PlanResult | null {
  const text = rawText.trim()
  if (!text) {
    return null
  }

  const mentionedFunctions = extractCatalogFunctionNames(catalog)
    .map((functionName) => ({
      functionName,
      index: text.indexOf(functionName)
    }))
    .filter((match) => match.index >= 0)
    .sort((a, b) => a.index - b.index)

  if (mentionedFunctions.length === 0) {
    return null
  }

  const seen = new Set<string>()
  const steps = mentionedFunctions
    .filter((match) => {
      if (seen.has(match.functionName)) {
        return false
      }

      seen.add(match.functionName)
      return true
    })
    .map((match) => ({
      function: match.functionName,
      label: buildRecoveredPlanStepLabel(match.functionName)
    }))

  LogHelper.title(`${DUTY_NAME} / planning`)
  LogHelper.debug(
    `Planning: recovered plan from function mentions: ${steps.map((step) => step.function).join(' -> ')}`
  )

  return {
    type: 'plan',
    steps,
    summary: 'Running the recovered tool plan...'
  }
}

export async function runPlanningPhase(
  caller: LLMCaller,
  catalog: Catalog,
  history: MessageLog[],
  onPlanningStage?: (stage: 'thinking') => void
): Promise<PlanResult> {
  const catalogNote =
    catalog.mode === 'tool'
      ? '\nNote: The catalog lists tools, not individual functions. Use the format toolkit_id.tool_id in your plan steps.'
      : ''
  const planSystemPrompt = buildPhaseSystemPrompt(
    PLAN_SYSTEM_PROMPT,
    'planning'
  )
  const selfModelSection = buildSelfModelSection(caller.getSelfModelSnapshot())
  const contextManifestSection = buildContextManifestSection(
    caller.getContextManifest()
  )
  const activeAgentSkillSection =
    buildActiveAgentSkillSection(caller.agentSkillContext)
  const agentSkillSection =
    activeAgentSkillSection || buildAgentSkillDiscoverySection(caller)
  const previousToolArtifacts =
    (await caller.getPreviousToolArtifacts?.())?.trim() || ''
  const previousToolArtifactsSection = previousToolArtifacts
    ? `\n\n<previous_tool_outputs>\nUse these exact outputLogPath values with ${READ_TOOL_ARTIFACT_FUNCTION} when a previous tool result is needed in full. Do not invent output file paths.\n${previousToolArtifacts}\n</previous_tool_outputs>`
    : ''
  const prompt = `<context_manifest>\n${contextManifestSection}\n</context_manifest>\n\n${agentSkillSection}\n\n<available_catalog>\n${catalog.text}${catalogNote}\n</available_catalog>\n\n<self_model>\n${selfModelSection}\n</self_model>\n\n<grounding_note>\nEnvironment context is available through structured_knowledge.context tools when needed.\n</grounding_note>${previousToolArtifactsSection}\n\n<user_request>\n${caller.input}\n</user_request>`

  const planSchema = PLAN_RESPONSE_SCHEMA

  const attemptForcedPlanOnlyFallback = async (): Promise<PlanResult | null> => {
    onPlanningStage?.('thinking')
    const forcedPlanPrompt = `${prompt}\n\n<safety_fallback>\nReturn ONLY type="plan" with one or more concrete tool steps. Do not return type="final".\n</safety_fallback>`
    const forcedPlanSchema = {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['plan'] },
        steps: {
          type: 'array',
          minItems: 1,
          items: PLAN_STEP_SCHEMA
        },
        summary: { type: 'string' }
      },
      required: ['type', 'steps', 'summary'],
      additionalProperties: false
    }

    const forcedPlanResult = await caller.callLLM(
      forcedPlanPrompt,
      planSystemPrompt,
      forcedPlanSchema,
      history,
      buildPlanningPromptSections({
        prompt: forcedPlanPrompt,
        systemPrompt: planSystemPrompt,
        includeSchema: true,
        schemaOverride: forcedPlanSchema
      }),
      {
        phase: 'planning'
      }
    )

    const forcedParsed = parseOutput(forcedPlanResult?.output)
    const forcedInterpreted =
      (forcedParsed
        ? extractPlanResultFromCreatePlanArgs(forcedParsed, {
            allowLegacySummaryAsFinal: false,
            source: 'planning'
          })
        : null) || extractPlanFromParsed(forcedParsed, 'planning')

    if (forcedInterpreted?.type === 'plan' && forcedInterpreted.steps.length > 0) {
      LogHelper.debug(
        'Planning: forced plan-only fallback produced executable steps'
      )
      return forcedInterpreted
    }

    const rawForcedOutput =
      typeof forcedPlanResult?.output === 'string'
        ? forcedPlanResult.output
        : ''
    const recoveredForcedPlan = recoverPlanFromFunctionMentions(
      rawForcedOutput,
      catalog
    )
    if (recoveredForcedPlan) {
      return recoveredForcedPlan
    }

    LogHelper.debug(
      'Planning: forced plan-only fallback did not produce a valid plan'
    )
    return null
  }

  // --- Remote providers: use native tool calling to force structured output ---
  if (caller.supportsNativeTools) {
    onPlanningStage?.('thinking')
    const planTools: OpenAITool[] = [
      {
        type: 'function',
        function: {
          name: 'create_plan',
          description:
            'Create either an execution plan or a handoff signal. Use type="plan" when tools are needed, or type="final" for answer/clarification/cancel/error handoff. If you do not call this tool, output plain text prefixed with "FINAL_ANSWER:".',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['plan', 'final'],
                description:
                  'Use "plan" when tools are needed, "final" for direct conversational handoff.'
              },
              steps: {
                type: 'array',
                items: {
                  ...PLAN_STEP_SCHEMA,
                  properties: {
                    function: {
                      type: 'string',
                      description:
                        'Fully qualified function name: toolkit_id.tool_id.function_name'
                    },
                    label: {
                      type: 'string',
                      description:
                        'Short user-facing task description starting with a verb, under 8 words'
                    },
                    agent_skill_id: {
                      type: 'string',
                      description:
                        'Optional exact Agent Skill id from available_agent_skills for this step only'
                    }
                  }
                },
                description:
                  'For type="plan", the ordered execution steps. For type="final", set to null or omit.'
              },
              summary: {
                type: 'string',
                description:
                  'For type="plan", a short plan summary. For type="final", set to null or omit.'
              },
              answer: {
                type: 'string',
                description:
                  'For type="final", provide a short semantic handoff note for the final answer phase. Keep it content-focused and tone-neutral. Do not write polished user-facing wording. For type="plan", set to null or omit.'
              },
              intent: {
                type: 'string',
                enum: ['answer', 'clarification', 'cancelled', 'error'],
                description:
                  'For type="final", set the handoff intent. Use "answer" unless clarification, cancelled, or error is required. For type="plan", set to null or omit.'
              }
            },
            required: ['type'],
            additionalProperties: false
          }
        }
      }
    ]

    const isForcedCreatePlanChoice =
      getLLMProviderName() === LLMProviders.LlamaCPP
    const planningToolChoice = isForcedCreatePlanChoice
      ? ({ type: 'function', function: { name: 'create_plan' } } as const)
      : 'auto'

    const toolResult = await caller.callLLMWithTools(
      prompt,
      planSystemPrompt,
      planTools,
      planningToolChoice,
      history,
      false,
      buildPlanningPromptSections({
        prompt,
        systemPrompt: planSystemPrompt,
        includeTools: true,
        tools: planTools
      }),
      {
        phase: 'planning'
      }
    )

    LogHelper.title(`${DUTY_NAME} / planning`)
    LogHelper.debug(
      `Planning tool result: ${JSON.stringify(toolResult)}`
    )

    if (!toolResult) {
      const providerError = caller.consumeProviderErrorMessage()
      if (providerError) {
        LogHelper.debug(
          `Planning aborted due to provider error: "${providerError}"`
        )
        return createPlanningHandoff(providerError, 'error')
      }
    }

    const textFallback = toolResult?.textContent?.trim() || ''
    const markedTextFallbackFinalAnswer =
      extractPlanningMarkedFinalAnswer(textFallback)
    const textFallbackHandoffDraft =
      extractPlanningTextHandoffDraft(textFallback)
    const missingCreatePlanToolCall =
      !toolResult?.toolCall && !toolResult?.unexpectedToolCall

    const attemptForcedPlanFallbackAfterMissingToolCall = async (): Promise<
      PlanResult | null
    > => {
      if (!missingCreatePlanToolCall) {
        return null
      }

      return attemptForcedPlanOnlyFallback()
    }

    if (toolResult?.toolCall) {
      if (toolResult.toolCall.functionName === 'create_plan') {
        const parsedArgs = parseToolCallArguments(
          toolResult.toolCall.arguments
        )
        if (parsedArgs) {
          const interpreted = extractPlanResultFromCreatePlanArgs(parsedArgs, {
            allowLegacySummaryAsFinal: true,
            source: 'planning'
          })
          if (interpreted) {
            if (
              interpreted.type === 'plan' &&
              isOperatingSystemControlOnlyPlan(interpreted.steps)
            ) {
              LogHelper.debug(
                'Planning: operating_system_control-only plan returned; memory access should use structured_knowledge.memory.read when relevant.'
              )
            }
            return interpreted
          }

          LogHelper.debug(
            'Planning: create_plan payload did not satisfy plan contract; falling back to JSON mode'
          )
        } else {
          LogHelper.debug('Planning: failed to parse create_plan arguments')
        }
      } else {
        const directPlan = createPlanFromUnexpectedToolCall(
          {
            functionName: toolResult.toolCall.functionName,
            arguments: toolResult.toolCall.arguments
          },
          textFallback
        )
        if (directPlan) {
          LogHelper.debug(
            `Planning: recovered direct tool call "${toolResult.toolCall.functionName}" into a single-step plan`
          )
          return directPlan
        }

        LogHelper.debug(
          `Planning: unexpected tool call "${toolResult.toolCall.functionName}" (expected "create_plan"), falling back to JSON mode`
        )
      }
    } else if (toolResult?.unexpectedToolCall) {
      const directPlan = createPlanFromUnexpectedToolCall(
        toolResult.unexpectedToolCall,
        textFallback
      )
      if (directPlan) {
        LogHelper.debug(
          `Planning: recovered unexpected tool call "${toolResult.unexpectedToolCall.functionName}" into a single-step plan`
        )
        return directPlan
      }

      LogHelper.debug(
        `Planning: unexpected tool call "${toolResult.unexpectedToolCall.functionName}"${
          isForcedCreatePlanChoice
            ? ' while forcing "create_plan"'
            : ''
        }, falling back to JSON mode`
      )
    } else {
      const textFallbackParsed = parseOutput(textFallback)
      const textFallbackPlan =
        (textFallbackParsed
          ? extractPlanResultFromCreatePlanArgs(textFallbackParsed, {
              allowLegacySummaryAsFinal: true,
              source: 'planning'
            })
          : null) || extractPlanFromParsed(textFallbackParsed, 'planning')
      if (textFallbackPlan) {
        if (shouldAttemptForcedPlanFallback(textFallbackPlan)) {
          const forcedPlan =
            await attemptForcedPlanFallbackAfterMissingToolCall()
          if (forcedPlan) {
            return forcedPlan
          }
        }
        LogHelper.debug(
          'Planning: recovered structured output from text fallback (no JSON fallback needed)'
        )
        return textFallbackPlan
      }

      const recoveredTextPlan = recoverPlanFromFunctionMentions(
        textFallback,
        catalog
      )
      if (recoveredTextPlan) {
        return recoveredTextPlan
      }

      if (
        textFallback &&
        shouldTreatPlanningTextAsFinalAnswer(textFallback)
      ) {
        LogHelper.debug(
          markedTextFallbackFinalAnswer
            ? 'Planning: returning direct final answer from marked text fallback'
            : 'Planning: plain text fallback received without tool call; routing to final answer handoff'
        )
        return createPlanningHandoff(
          textFallbackHandoffDraft || markedTextFallbackFinalAnswer || textFallback,
          'answer'
        )
      } else {
        LogHelper.debug('Planning: no tool call returned, falling back to JSON mode')
      }
    }

    // Final fallback: JSON mode planning
    onPlanningStage?.('thinking')
    const jsonModeResult = await caller.callLLM(
      prompt,
      planSystemPrompt,
      planSchema,
      history,
      buildPlanningPromptSections({
        prompt,
        systemPrompt: planSystemPrompt,
        includeSchema: true
      }),
      {
        phase: 'planning'
      }
    )
    if (!jsonModeResult) {
      const providerError = caller.consumeProviderErrorMessage()
      if (providerError) {
        if (textFallbackHandoffDraft) {
          LogHelper.debug(
            'Planning JSON fallback failed; reusing preserved plain text handoff'
          )
          return createPlanningHandoff(textFallbackHandoffDraft, 'answer')
        }
        LogHelper.debug(
          `Planning JSON fallback aborted due to provider error: "${providerError}"`
        )
        return createPlanningHandoff(providerError, 'error')
      }
    }
    const parsed = parseOutput(jsonModeResult?.output)
    const planResult =
      (parsed
        ? extractPlanResultFromCreatePlanArgs(parsed, {
            allowLegacySummaryAsFinal: true,
            source: 'planning'
          })
        : null) || extractPlanFromParsed(parsed, 'planning')
    if (planResult) {
      if (shouldAttemptForcedPlanFallback(planResult)) {
        const forcedPlan =
          await attemptForcedPlanFallbackAfterMissingToolCall()
        if (forcedPlan) {
          return forcedPlan
        }
      }
      return planResult
    }

    const textFallbackParsed = parseOutput(textFallback)
    const textFallbackPlan =
      (textFallbackParsed
        ? extractPlanResultFromCreatePlanArgs(textFallbackParsed, {
            allowLegacySummaryAsFinal: true,
            source: 'planning'
          })
        : null) || extractPlanFromParsed(textFallbackParsed, 'planning')
    if (textFallbackPlan) {
      if (shouldAttemptForcedPlanFallback(textFallbackPlan)) {
        const forcedPlan =
          await attemptForcedPlanFallbackAfterMissingToolCall()
        if (forcedPlan) {
          return forcedPlan
        }
      }
      LogHelper.debug('Planning: recovered structured output from text fallback')
      return textFallbackPlan
    }

    const recoveredTextPlan = recoverPlanFromFunctionMentions(
      textFallback,
      catalog
    )
    if (recoveredTextPlan) {
      return recoveredTextPlan
    }

    if (
      textFallbackHandoffDraft
    ) {
      LogHelper.debug(
        'Planning: using preserved text fallback as final conversational answer'
      )
      return createPlanningHandoff(textFallbackHandoffDraft, 'answer')
    }

    const raw =
      typeof jsonModeResult?.output === 'string'
        ? jsonModeResult.output.trim()
        : ''
    const rawHandoffDraft = extractPlanningTextHandoffDraft(raw)
    if (raw) {
      const parsedRaw = parseOutput(raw)
      const parsedRawPlan =
        (parsedRaw
          ? extractPlanResultFromCreatePlanArgs(parsedRaw, {
              allowLegacySummaryAsFinal: true,
              source: 'planning'
            })
          : null) || extractPlanFromParsed(parsedRaw, 'planning')
      if (parsedRawPlan) {
        if (shouldAttemptForcedPlanFallback(parsedRawPlan)) {
          const forcedPlan =
            await attemptForcedPlanFallbackAfterMissingToolCall()
          if (forcedPlan) {
            return forcedPlan
          }
        }
        return parsedRawPlan
      }

      const recoveredRawPlan = recoverPlanFromFunctionMentions(raw, catalog)
      if (recoveredRawPlan) {
        return recoveredRawPlan
      }

      if (rawHandoffDraft) {
        return createPlanningHandoff(rawHandoffDraft, 'answer')
      }
    }

    if (textFallback) {
      const forcedPlan = await attemptForcedPlanFallbackAfterMissingToolCall()
      if (forcedPlan) {
        return forcedPlan
      }
      if (textFallbackHandoffDraft) {
        return createPlanningHandoff(textFallbackHandoffDraft, 'answer')
      }
      return {
        type: 'handoff',
        signal: {
          intent: 'error',
          draft: 'I could not produce a structured plan. Please rephrase your request.',
          source: 'planning'
        }
      }
    }

    return createPlanningHandoff(
      raw || 'I could not determine what to do.',
      'error'
    )
  }

  // --- Local provider: use grammar-constrained JSON mode ---
  onPlanningStage?.('thinking')
  const completionResult = await caller.callLLM(
    prompt,
    planSystemPrompt,
    planSchema,
    history,
    buildPlanningPromptSections({
      prompt,
      systemPrompt: planSystemPrompt,
      includeSchema: true
    }),
    {
      phase: 'planning'
    }
  )
  if (!completionResult) {
    const providerError = caller.consumeProviderErrorMessage()
    if (providerError) {
      return createPlanningHandoff(providerError, 'error')
    }
  }

  const parsed = parseOutput(completionResult?.output)
  const planResult =
    (parsed
      ? extractPlanResultFromCreatePlanArgs(parsed, {
          allowLegacySummaryAsFinal: true,
          source: 'planning'
        })
      : null) || extractPlanFromParsed(parsed, 'planning')
  if (planResult) {
    if (shouldAttemptForcedPlanFallback(planResult)) {
      const forcedPlan = await attemptForcedPlanOnlyFallback()
      if (forcedPlan) {
        return forcedPlan
      }
    }

    return planResult
  }

  // Fallback
  const raw =
    typeof completionResult?.output === 'string'
      ? completionResult.output.trim()
      : ''
  if (raw) {
    const parsedRaw = parseOutput(raw)
    const parsedRawPlan =
      (parsedRaw
        ? extractPlanResultFromCreatePlanArgs(parsedRaw, {
            allowLegacySummaryAsFinal: true,
            source: 'planning'
          })
        : null) || extractPlanFromParsed(parsedRaw, 'planning')
    if (parsedRawPlan) {
      if (shouldAttemptForcedPlanFallback(parsedRawPlan)) {
        const forcedPlan = await attemptForcedPlanOnlyFallback()
        if (forcedPlan) {
          return forcedPlan
        }
      }

      return parsedRawPlan
    }

    const recoveredRawPlan = recoverPlanFromFunctionMentions(raw, catalog)
    if (recoveredRawPlan) {
      return recoveredRawPlan
    }

    const rawHandoffDraft = extractPlanningTextHandoffDraft(raw)
    if (rawHandoffDraft) {
      return createPlanningHandoff(rawHandoffDraft, 'answer')
    }

    if (shouldTreatPlainPlanningTextAsFinalAnswer(raw)) {
      LogHelper.debug(
        'Planning: local JSON mode returned plain conversational text; routing to final answer handoff'
      )
      return createPlanningHandoff(raw, 'answer')
    }
  }

  const forcedPlan = await attemptForcedPlanOnlyFallback()
  if (forcedPlan) {
    return forcedPlan
  }

  return createPlanningHandoff(
    'I could not produce a structured plan. Please rephrase your request.',
    'error'
  )
}
