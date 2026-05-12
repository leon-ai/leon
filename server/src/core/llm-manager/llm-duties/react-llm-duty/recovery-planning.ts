import { LogHelper } from '@/helpers/log-helper'
import type { OpenAITool } from '@/core/llm-manager/types'
import type { MessageLog } from '@/types'

import { RECOVERY_PLAN_SYSTEM_PROMPT, DUTY_NAME } from './constants'
import type {
  Catalog,
  ExecutionRecord,
  LLMCaller,
  PlanResult,
  PlanStep,
  PromptLogSection,
  FinalPhaseIntent
} from './types'
import {
  formatExecutionHistory,
  extractPlanFromParsed,
  parseOutput,
  parseToolCallArguments,
  extractPlanResultFromCreatePlanArgs
} from './utils'
import {
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

function buildRecoveryPromptSections(params: {
  prompt: string
  systemPrompt: string
  tools?: OpenAITool[]
  includeSchema?: boolean
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
      content: RECOVERY_PLAN_SYSTEM_PROMPT
    },
    {
      name: 'RECOVERY_INPUT',
      source:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/recovery-planning.ts',
      content: params.prompt
    }
  ]

  if (params.tools) {
    sections.push({
      name: 'TOOLS_SCHEMA',
      source:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/recovery-planning.ts',
      content: JSON.stringify(params.tools)
    })
  }

  if (params.includeSchema) {
    sections.push({
      name: 'PLAN_SCHEMA',
      source:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/plan-contract.ts',
      content: JSON.stringify(PLAN_RESPONSE_SCHEMA)
    })
  }

  return sections
}

function createRecoveryHandoff(
  draft: string,
  intent: FinalPhaseIntent = 'answer'
): PlanResult {
  return {
    type: 'handoff',
    signal: {
      intent,
      draft,
      source: 'recovery'
    }
  }
}

export async function runRecoveryPlanningPhase(
  caller: LLMCaller,
  catalog: Catalog,
  history: MessageLog[],
  executionHistory: ExecutionRecord[],
  failedStep: PlanStep,
  pendingSteps: PlanStep[]
): Promise<PlanResult | null> {
  const catalogNote =
    catalog.mode === 'tool'
      ? '\nNote: The catalog lists tools, not individual functions. Use the format toolkit_id.tool_id in your plan steps.'
      : ''
  const recoverySystemPrompt = buildPhaseSystemPrompt(
    RECOVERY_PLAN_SYSTEM_PROMPT,
    'recovery'
  )
  const selfModelSection = buildSelfModelSection(caller.getSelfModelSnapshot())
  const contextManifestSection = buildContextManifestSection(
    caller.getContextManifest()
  )
  const failedStepAgentSkillContext = failedStep.agentSkillId
    ? await caller.getAgentSkillContext(failedStep.agentSkillId)
    : null
  const activeAgentSkillSection = buildActiveAgentSkillSection(
    failedStepAgentSkillContext || caller.agentSkillContext
  )
  const agentSkillSection =
    activeAgentSkillSection || buildAgentSkillDiscoverySection(caller)
  const failedExecution = executionHistory[executionHistory.length - 1]
  const historySection = formatExecutionHistory(executionHistory)
  const pendingStepsSection =
    pendingSteps.length > 0
      ? pendingSteps
          .map((step, index) => {
            const skillSuffix = step.agentSkillId
              ? ` | agent_skill_id=${step.agentSkillId}`
              : ''
            return `- ${index + 1}. ${step.function}${skillSuffix} | "${step.label}"`
          })
          .join('\n')
      : '- none'
  const prompt = `<context_manifest>
${contextManifestSection}
</context_manifest>

${agentSkillSection}

<available_catalog>
${catalog.text}${catalogNote}
</available_catalog>

<self_model>
${selfModelSection}
</self_model>

<grounding_note>
Environment context is available through structured_knowledge.context tools when needed.
</grounding_note>

<recovery_context>
- Failed Step Function: ${failedStep.function}
- Failed Step Label: ${failedStep.label}
- Failed Observation: ${failedExecution?.observation || 'No observation available'}
</recovery_context>

<remaining_steps>
${pendingStepsSection}
</remaining_steps>

<execution_history>
${historySection}
</execution_history>

<user_request>
${caller.input}
</user_request>

<task>
Create a revised plan from this point to complete the user request.
</task>`

  const planSchema = PLAN_RESPONSE_SCHEMA

  LogHelper.title(`${DUTY_NAME} / recovery`)
  LogHelper.debug(
    `Recovery planning triggered after failed step "${failedStep.label}" (${failedStep.function})`
  )

  let textFallbackHandoffDraft: string | null = null

  if (caller.supportsNativeTools) {
    const planTools: OpenAITool[] = [
      {
        type: 'function',
        function: {
          name: 'create_plan',
          description:
            'Create a revised execution plan or direct conversational handoff. Use type="plan" with steps+summary, or type="final" with answer when user input is needed or execution must stop.',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['plan', 'final']
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
                  },
                  required: ['function', 'label']
                }
              },
              summary: {
                type: 'string',
                description:
                  'For type="plan", a short summary of the revised plan. For type="final", set to null or omit.'
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

    const toolResult = await caller.callLLMWithTools(
      prompt,
      recoverySystemPrompt,
      planTools,
      'auto',
      history,
      false,
      buildRecoveryPromptSections({
        prompt,
        systemPrompt: recoverySystemPrompt,
        tools: planTools
      }),
      {
        phase: 'recovery'
      }
    )

    if (!toolResult) {
      const providerError = caller.consumeProviderErrorMessage()
      if (providerError) {
        return createRecoveryHandoff(providerError, 'error')
      }
    }

    LogHelper.title(`${DUTY_NAME} / recovery`)
    LogHelper.debug(
      `Recovery planning tool result: ${JSON.stringify(toolResult)}`
    )

    if (toolResult?.toolCall?.functionName === 'create_plan') {
      const parsedArgs = parseToolCallArguments(
        toolResult.toolCall.arguments
      )
      if (parsedArgs) {
        const interpreted = extractPlanResultFromCreatePlanArgs(parsedArgs, {
          allowLegacySummaryAsFinal: true,
          source: 'recovery'
        })
        if (interpreted) {
          return interpreted
        }

        LogHelper.debug(
          'Recovery planning: create_plan payload did not satisfy plan contract; falling back to JSON mode'
        )
      } else {
        LogHelper.debug('Recovery planning: failed to parse create_plan arguments')
      }
    } else if (toolResult?.toolCall) {
      const directPlan = createPlanFromUnexpectedToolCall(
        {
          functionName: toolResult.toolCall.functionName,
          arguments: toolResult.toolCall.arguments
        },
        toolResult.textContent?.trim() || ''
      )
      if (directPlan) {
        LogHelper.debug(
          `Recovery planning: recovered direct tool call "${toolResult.toolCall.functionName}" into a single-step plan`
        )
        return directPlan
      }
    } else if (toolResult?.unexpectedToolCall) {
      const directPlan = createPlanFromUnexpectedToolCall(
        toolResult.unexpectedToolCall,
        toolResult.textContent?.trim() || ''
      )
      if (directPlan) {
        LogHelper.debug(
          `Recovery planning: recovered unexpected tool call "${toolResult.unexpectedToolCall.functionName}" into a single-step plan`
        )
        return directPlan
      }
    }

    const textFallback = toolResult?.textContent?.trim() || ''
    textFallbackHandoffDraft = extractPlanningTextHandoffDraft(textFallback)
    const parsedTextFallback = parseOutput(textFallback)
    const extractedPlan =
      (parsedTextFallback
        ? extractPlanResultFromCreatePlanArgs(parsedTextFallback, {
            allowLegacySummaryAsFinal: true,
            source: 'recovery'
          })
        : null) || extractPlanFromParsed(parsedTextFallback, 'recovery')
    if (extractedPlan) {
      return extractedPlan
    }

    if (textFallbackHandoffDraft) {
      return createRecoveryHandoff(textFallbackHandoffDraft, 'answer')
    }
  }

  const jsonModeResult = await caller.callLLM(
    prompt,
    recoverySystemPrompt,
    planSchema,
    history,
    buildRecoveryPromptSections({
      prompt,
      systemPrompt: recoverySystemPrompt,
      includeSchema: true
    }),
    {
      phase: 'recovery'
    }
  )
  if (!jsonModeResult) {
    const providerError = caller.consumeProviderErrorMessage()
    if (providerError) {
      if (textFallbackHandoffDraft) {
        return createRecoveryHandoff(textFallbackHandoffDraft, 'answer')
      }
      return createRecoveryHandoff(providerError, 'error')
    }
  }
  const parsed = parseOutput(jsonModeResult?.output)
  const planResult =
    (parsed
      ? extractPlanResultFromCreatePlanArgs(parsed, {
          allowLegacySummaryAsFinal: true,
          source: 'recovery'
        })
      : null) || extractPlanFromParsed(parsed, 'recovery')
  if (planResult) {
    return planResult
  }

  const raw =
    typeof jsonModeResult?.output === 'string'
      ? jsonModeResult.output.trim()
      : ''
  const rawHandoffDraft = extractPlanningTextHandoffDraft(raw)

  if (rawHandoffDraft) {
    return createRecoveryHandoff(rawHandoffDraft, 'answer')
  }

  return null
}
