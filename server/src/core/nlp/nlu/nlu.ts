import type {
  NLPSkill,
  NLPUtterance,
  NLUPartialProcessResult,
  NLUProcessResult,
  NLUResult
} from '@/core/nlp/types'
import type { SkillSchema } from '@/schemas/skill-schemas'
import type {
  BrainProcessResult,
  SkillAnswerCoreData
} from '@/core/brain/types'
import {
  type ActionCallingMissingParamsOutput,
  type ActionCallingOutput,
  ActionCallingStatus,
  type ActionCallingSuccessOutput,
  type SlotFillingOutput,
  SlotFillingStatus
} from '@/core/llm-manager/types'
import {
  BRAIN,
  CONVERSATION_LOGGER,
  SOCKET_SERVER,
  MEMORY_MANAGER,
  PERSONA,
  LLM_PROVIDER,
  TOOL_CALL_LOGGER,
  SELF_MODEL_MANAGER,
  PULSE_MANAGER
} from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import Conversation from '@/core/nlp/conversation'
import { syncOwnerProfileFromTurn } from '@/core/context-manager/owner-profile-sync'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import {
  DEFAULT_NLU_PROCESS_RESULT,
  NLUProcessResultUpdater
} from '@/core/nlp/nlu/nlu-process-result-updater'
import { SkillRouterLLMDuty } from '@/core/llm-manager/llm-duties/skill-router-llm-duty'
import { ActionCallingLLMDuty } from '@/core/llm-manager/llm-duties/action-calling-llm-duty'
import { SlotFillingLLMDuty } from '@/core/llm-manager/llm-duties/slot-filling-llm-duty'
import { ReActLLMDuty } from '@/core/llm-manager/llm-duties/react-llm-duty'
import { LEON_ROUTING_MODE } from '@/constants'
import { RoutingMode, SkillFormat } from '@/types'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { WorkflowProgressWidget } from '@/core/nlp/nlu/workflow-progress-widget'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'

// TODO: delete?
export const DEFAULT_NLU_RESULT = {
  utterance: '',
  newUtterance: '',
  currentEntities: [],
  entities: [],
  slots: {},
  skillConfigPath: '',
  answers: [], // For dialog action type
  sentiment: {},
  classification: {
    domain: '',
    skill: '',
    action: '',
    confidence: 0
  },
  actionConfig: null
}

type RoutingRoute = 'controlled' | 'react'

const NO_LLM_ENABLED_MESSAGE =
  'I need an AI engine before I can answer. Enable local AI or configure an online provider. Use the built-in command "/model <provider> <model name>" to configure a model. Just press "/" to open built-in commands.'
const SYSTEM_WIDGET_HISTORY_MODE = 'system_widget'

export default class NLU {
  private static instance: NLU
  // Used to store the current single-turn NLU process result
  private _nluProcessResult = DEFAULT_NLU_PROCESS_RESULT
  private _nluResult: NLUResult = DEFAULT_NLU_RESULT
  // Used to store the conversation state (across multiple turns)
  private readonly conversations = new Map<string, Conversation>()
  private hasHandledProviderFailure = false
  private _currentResponseRoute: RoutingRoute = 'controlled'
  private workflowProgress = new WorkflowProgressWidget()
  private pendingWorkflowNotFoundChoice: {
    originalUtterance: NLPUtterance
  } | null = null

  private readonly routingRoutes: Record<RoutingRoute, RoutingRoute> = {
    controlled: 'controlled',
    react: 'react'
  }

  public get conversation(): Conversation {
    const sessionId = getActiveConversationSessionId() || 'conv0'
    const existingConversation = this.conversations.get(sessionId)

    if (existingConversation) {
      return existingConversation
    }

    const conversation = new Conversation(sessionId)

    this.conversations.set(sessionId, conversation)

    return conversation
  }

  get nluProcessResult(): NLUProcessResult {
    return this._nluProcessResult
  }

  set nluProcessResult(newResult: NLUProcessResult) {
    this._nluProcessResult = newResult
  }

  get nluResult(): NLUResult {
    return this._nluResult
  }

  get currentResponseRoute(): RoutingRoute {
    return this._currentResponseRoute
  }

  async setNLUResult(newNLUResult: NLUResult): Promise<void> {
    /**
     * If the NLU process did not find any intent match, then immediately set the NLU result
     * as it is to avoid conflict
     */
    if (newNLUResult.classification.skill === 'None') {
      this._nluResult = newNLUResult
      return
    }

    const skillConfigPath =
      newNLUResult.skillConfigPath ||
      SkillDomainHelper.getNewSkillConfigPath(
        newNLUResult.classification.skill
      ) ||
      ''
    const skillConfig = await SkillDomainHelper.getNewSkillConfig(
      newNLUResult.classification.skill
    )
    const actions = skillConfig?.actions || {}

    this._nluResult = {
      ...newNLUResult,
      skillConfigPath,
      actionConfig: actions[
        newNLUResult.classification.action
      ] as NLUResult['actionConfig']
    }
  }

  constructor() {
    if (!NLU.instance) {
      LogHelper.title('NLU')
      LogHelper.success('New instance')

      NLU.instance = this
    }
  }

  private async handleProviderFailure(message?: string): Promise<boolean> {
    const providerError = message || LLM_PROVIDER.consumeLastProviderErrorMessage()

    if (!providerError) {
      return false
    }

    this.hasHandledProviderFailure = true

    LogHelper.title('NLU')
    LogHelper.warning(
      `Handled LLM provider failure locally: ${providerError}`
    )

    this.workflowProgress.reset()
    this.conversation.cleanActiveState()
    await NLUProcessResultUpdater.update(DEFAULT_NLU_PROCESS_RESULT)

    if (!BRAIN.isMuted) {
      await BRAIN.talk(providerError, true)
    }

    return true
  }

  private startWorkflowProgressForTurn(
    routingMode: RoutingMode,
    hasPendingAction: boolean
  ): void {
    this.workflowProgress.startTurn(routingMode, hasPendingAction)
  }

  private emitDeferredSkillWidget(
    processedData: Partial<BrainProcessResult>
  ): void {
    const lastOutputFromSkill = processedData.lastOutputFromSkill
    const widget = lastOutputFromSkill?.widget

    if (!widget || widget.historyMode === SYSTEM_WIDGET_HISTORY_MODE) {
      return
    }

    if (BRAIN.isMuted) {
      return
    }

    SOCKET_SERVER.emitAnswerToChatClients({
      ...widget,
      replaceMessageId: lastOutputFromSkill?.replaceMessageId || null
    })
  }

  private async chooseSkill(utterance: NLPUtterance): Promise<NLPSkill | null> {
    LogHelper.title('NLU')
    LogHelper.info('Choosing skill...')

    try {
      const skillRouterHistory = await CONVERSATION_LOGGER.load({
        nbOfLogsToLoad: 6
      })
      const skillRouterDuty = new SkillRouterLLMDuty({
        input: utterance,
        history: skillRouterHistory
      })

      await skillRouterDuty.init()

      const skillRouterResult = await skillRouterDuty.execute()
      if (!skillRouterResult) {
        await this.handleProviderFailure()
        return null
      }

      const skillResult = skillRouterResult?.output as unknown as string

      if (skillResult && skillResult !== 'None') {
        return skillResult as NLPSkill
      }

      return null
    } catch (e) {
      LogHelper.error(`Failed to choose skill: ${e}`)
    }

    return null
  }

  private async chooseSkillAction(
    utterance: NLPUtterance,
    skillName: NLPSkill
  ): Promise<ActionCallingOutput[] | null> {
    LogHelper.title('NLU')
    LogHelper.info(`Choosing action for skill: ${skillName}...`)

    try {
      const workflowContext = {
        recentUtterances: this._nluProcessResult.context.utterances.slice(-4),
        recentActionArguments:
          this._nluProcessResult.context.actionArguments.slice(-4),
        collectedParameters: this.conversation.activeState.collectedParameters,
        recentEntities: this._nluProcessResult.context.entities
          .slice(-8)
          .map((entity) => ({
            entity: entity.entity,
            sourceText: entity.sourceText,
            resolution: entity.resolution
          }))
      }
      const actionCallingHistory = await CONVERSATION_LOGGER.load({
        nbOfLogsToLoad: 6
      })
      const actionCallingDuty = new ActionCallingLLMDuty({
        input: utterance,
        skillName,
        workflowContext,
        history: actionCallingHistory
      })

      await actionCallingDuty.init()

      const actionCallingResult = await actionCallingDuty.execute()
      if (!actionCallingResult) {
        await this.handleProviderFailure()
        return null
      }

      const actionCallingOutput =
        actionCallingResult?.output as unknown as string
      const parsedActionCallingOutputs: ActionCallingOutput[] =
        JSON.parse(actionCallingOutput)

      return parsedActionCallingOutputs
    } catch (e) {
      LogHelper.error(`Failed to choose skill action: ${e}`)
    }

    return null
  }

  /**
   * Compute required parameters for an action by excluding optional_parameters
   */
  private getRequiredParamsForAction(
    actionConfig: NLUProcessResult['actionConfig']
  ): string[] {
    const allParams = Object.keys(actionConfig?.parameters || {})
    const optionalParams: string[] = (actionConfig?.optional_parameters ||
      []) as string[]
    return allParams.filter((p) => !optionalParams.includes(p))
  }

  private async jumpToNextAction(
    nextAction: SkillAnswerCoreData['next_action']
  ): Promise<void> {
    if (nextAction) {
      try {
        // eslint-disable-next-line prefer-const
        let [skillName, actionName] = nextAction.split(':')

        // Allow skill developers to omit the "_skill" suffix when specifying the skill name
        if (skillName && !skillName.endsWith('_skill')) {
          skillName = `${skillName}_skill`
        }

        LogHelper.title('NLU')
        LogHelper.info(
          `Skill requested a jump to the "${actionName}" action from the "${skillName}" skill`
        )

        if (skillName && actionName) {
          const previousSkillName = this._nluProcessResult.skillName

          // Update the NLU context to the new skill and action
          await NLUProcessResultUpdater.update({ skillName })
          await NLUProcessResultUpdater.update({ actionName })

          const nextActionConfig = this._nluProcessResult.actionConfig
          const requiredParams =
            this.getRequiredParamsForAction(nextActionConfig)
          const hasRequiredParams = requiredParams.length > 0

          // If we changed skills, clean active state to avoid leaking params across skills
          if (previousSkillName && previousSkillName !== skillName) {
            this.conversation.cleanActiveState()
            // Preserve starting utterance for the new pending action context
            this.conversation.setActiveState({
              startingUtterance: this._nluProcessResult.new
                .utterance as NLPUtterance
            })
          }

          if (!hasRequiredParams) {
            // Immediately trigger the new action if it has no parameters
            await this.handleActionSuccess({
              status: ActionCallingStatus.Success,
              name: actionName,
              // TODO: allow skill developers to pass arguments when jumping to another action
              arguments: {}
            })
          } else {
            // Prepare pending state and ask for missing parameters
            this.conversation.setActiveState({
              pendingAction: `${this._nluProcessResult.skillName}:${actionName}`,
              missingParameters: requiredParams,
              collectedParameters: {}
            })

            await this.sendSuggestions()
          }

          return
        }

        LogHelper.title('NLU')
        LogHelper.error(
          `Could not jump to action. Malformed value: "${nextAction}". Please use the format "skill_name:action_name", e.g., "music_skill:play_song"`
        )
      } catch (e) {
        LogHelper.title('NLU')
        LogHelper.error(`Failed to jump to next action: ${e}`)
      }
    }
  }

  /**
   * Checks for suggestions in the skill's locale data for the current action
   * and sends them to the client
   */
  private async sendSuggestions(): Promise<void> {
    try {
      const { skillName, actionName } = this._nluProcessResult
      const localeConfig = await SkillDomainHelper.getSkillLocaleConfig(
        BRAIN.lang,
        skillName
      )

      if ('actions' in localeConfig) {
        const suggestions = localeConfig?.actions?.[actionName]?.suggestions

        if (suggestions && suggestions.length > 0) {
          LogHelper.title('NLU')
          LogHelper.info(`Sending suggestions for action "${actionName}"`)

          BRAIN.suggest(suggestions)
        }
      }
    } catch (e) {
      LogHelper.title('NLU')
      LogHelper.error(`Failed to send suggestions: ${e}`)
    }
  }

  private async handleSkillWorkflow(
    workflow: SkillSchema['workflow']
  ): Promise<boolean> {
    if (workflow) {
      LogHelper.title('NLU')
      LogHelper.info('Handling skill workflow...')

      try {
        const currentAction = this._nluProcessResult.actionName
        const currentActionIndex = workflow.indexOf(currentAction)
        const isLastActionInWorkflow =
          currentActionIndex === workflow.length - 1

        /**
         * If the current action is not the last one in the workflow,
         * prepare the next action
         */
        if (!isLastActionInWorkflow) {
          const nextActionName = workflow[currentActionIndex + 1] as string

          if (nextActionName.includes(':')) {
            // This is a cross-skill action call
            const [crossSkillName] = nextActionName.split(':')
            const originalSkillName = this._nluProcessResult.skillName

            await this.jumpToNextAction(nextActionName)

            // After cross-skill action completes, return to original skill and continue workflow
            if (crossSkillName !== originalSkillName) {
              // Continue with the remaining actions in the workflow (after the cross-skill call)
              const remainingWorkflow = workflow.slice(currentActionIndex + 2)
              const isRemainingWorkflowNotDone = remainingWorkflow.length > 0

              if (isRemainingWorkflowNotDone) {
                const nextOriginalAction = remainingWorkflow[0] as string

                await NLUProcessResultUpdater.update({
                  skillName: originalSkillName,
                  actionName: nextOriginalAction
                })

                return await this.handleSkillWorkflow(remainingWorkflow)
              }

              // No more actions in workflow, clean up
              this.conversation.cleanActiveState()
              await NLUProcessResultUpdater.update(DEFAULT_NLU_PROCESS_RESULT)

              return false
            }

            return true
          }

          await NLUProcessResultUpdater.update({
            actionName: nextActionName
          })

          const nextActionConfig = this._nluProcessResult.actionConfig

          this.conversation.setActiveState({
            pendingAction: `${this._nluProcessResult.skillName}:${nextActionName}`,
            missingParameters:
              this.getRequiredParamsForAction(nextActionConfig),
            collectedParameters: {}
          })

          /**
           * If the next action in the workflow has no parameters, execute it immediately
           * without waiting for another user input. E.g., the "set_up" action
           */
          if (this.getRequiredParamsForAction(nextActionConfig).length === 0) {
            await this.handleActionSuccess({
              status: ActionCallingStatus.Success,
              name: nextActionName,
              arguments: {}
            })
          } else {
            // The current action is finished. Clear the workflow widget before
            // waiting for the owner's input for the next action in the workflow.
            this.workflowProgress.completeAll()
            this.workflowProgress.reset()
            await this.sendSuggestions()
          }

          return true
        }

        return false
      } catch (e) {
        LogHelper.title('NLU')
        LogHelper.error(`Failed to handle skill workflow: ${e}`)
      }
    }

    return false
  }

  private async handleSkillOrActionNotFound(): Promise<void> {
    LogHelper.title('NLU')
    LogHelper.warning('Skill or action not found')

    this.conversation.cleanActiveState()
    await NLUProcessResultUpdater.update(DEFAULT_NLU_PROCESS_RESULT)

    const leonMode = this.getLeonMode()
    if (leonMode === RoutingMode.Controlled) {
      this.workflowProgress.completeSelectionNotFound()
      this.workflowProgress.reset()
      const utterance = this._nluProcessResult.new.utterance as NLPUtterance
      if (!utterance) {
        return
      }

      this.pendingWorkflowNotFoundChoice = {
        originalUtterance: utterance
      }

      if (!BRAIN.isMuted) {
        await BRAIN.talk(
          'I couldn\'t find a matching skill or action for this request. Do you want me to fall back to agent mode for it, write the code for a new skill, or cancel?',
          true
        )
      }

      BRAIN.suggest([
        'Fallback to agent mode',
        'Write the skill code',
        'Cancel'
      ])
      return
    }

    const routingDecision = {
      mode: leonMode,
      route: this.routingRoutes.react,
      reason: 'skill_not_found'
    }
    if (leonMode === RoutingMode.Smart) {
      this.workflowProgress.completeRoutingOnly()
      this.workflowProgress.reset()
    }
    LogHelper.title('NLU')
    LogHelper.info(
      `Routing decision: mode=${routingDecision.mode} route=${routingDecision.route} reason=${routingDecision.reason}`
    )

    const utterance = this._nluProcessResult.new.utterance as NLPUtterance
    if (utterance) {
      await this.runReAct(utterance)
    }

    // TODO: core rewrite chit-chat duty / or conversation skill?
  }

  private async handlePendingWorkflowNotFoundChoice(
    utterance: NLPUtterance
  ): Promise<boolean> {
    if (!this.pendingWorkflowNotFoundChoice) {
      return false
    }

    const choiceDuty = new SlotFillingLLMDuty({
      input: {
        slotName: 'workflow_not_found_choice',
        slotDescription:
          'Return exactly one of these values: "fallback_to_agent" if the owner wants Leon to handle the original request via agent mode, "write_skill_code" if the owner wants Leon to write the code for a new skill, or "cancel" if the owner does not want either option.',
        slotType: 'string',
        latestUtterance: utterance,
        recentUtterances: this._nluProcessResult.context.utterances.slice(-4)
      },
      startingUtterance: this.pendingWorkflowNotFoundChoice.originalUtterance
    })

    await choiceDuty.init()

    const choiceResult = await choiceDuty.execute()
    if (!choiceResult) {
      await this.handleProviderFailure()
      return true
    }

    const output = choiceResult.output as unknown as SlotFillingOutput
    const choiceValue =
      output.status === SlotFillingStatus.Success
        ? String(output.filled_slots['workflow_not_found_choice'] || '')
            .trim()
            .toLowerCase()
        : ''

    const originalUtterance = this.pendingWorkflowNotFoundChoice.originalUtterance

    if (choiceValue === 'fallback_to_agent') {
      this.pendingWorkflowNotFoundChoice = null
      await this.runReAct(originalUtterance)
      return true
    }

    if (choiceValue === 'write_skill_code') {
      this.pendingWorkflowNotFoundChoice = null
      await this.runSkillWriterCreateSkill(originalUtterance)
      return true
    }

    this.pendingWorkflowNotFoundChoice = null

    if (choiceValue === 'cancel') {
      if (!BRAIN.isMuted) {
        await BRAIN.talk('Alright, cancelled.', true)
      }

      return true
    }

    if (!BRAIN.isMuted) {
      await BRAIN.talk('Alright, cancelled.', true)
    }

    return true
  }

  private getLeonMode(): RoutingMode {
    return this.resolveLeonMode()
  }

  private resolveLeonMode(forcedMode?: RoutingMode): RoutingMode {
    if (
      forcedMode === RoutingMode.Controlled ||
      forcedMode === RoutingMode.Agent ||
      forcedMode === RoutingMode.Smart
    ) {
      return forcedMode
    }

    const runtimeRoutingMode = CONFIG_STATE.getRoutingModeState().getRoutingMode()
    const mode = String(runtimeRoutingMode || RoutingMode.Smart).toLowerCase()
    if (
      mode === RoutingMode.Controlled ||
      mode === RoutingMode.Agent ||
      mode === RoutingMode.Smart
    ) {
      return mode as RoutingMode
    }

    LogHelper.title('NLU')
    LogHelper.warning(
      `Unknown LEON_ROUTING_MODE "${runtimeRoutingMode || LEON_ROUTING_MODE}", defaulting to smart`
    )

    return RoutingMode.Smart
  }

  private getWorkflowUtterance(
    utterance: NLPUtterance,
    forcedSkillName?: NLPSkill
  ): NLPUtterance {
    if (!forcedSkillName) {
      return utterance
    }

    const trimmedUtterance = utterance.trim()
    const utteranceTokens = trimmedUtterance.split(/\s+/).filter(Boolean)
    const normalizedCommand = utteranceTokens[0]?.toLowerCase() || ''
    const normalizedSkillName = SkillDomainHelper.getSkillCommandName(
      forcedSkillName
    ).toLowerCase()

    if (
      utteranceTokens.length < 2 ||
      (normalizedCommand !== '/skill' && normalizedCommand !== '/s') ||
      utteranceTokens[1]?.toLowerCase() !== normalizedSkillName
    ) {
      return utterance
    }

    return utteranceTokens.slice(2).join(' ').trim()
  }

  private getToolUtterance(
    utterance: NLPUtterance,
    forcedToolName?: string
  ): NLPUtterance {
    if (!forcedToolName) {
      return utterance
    }

    const trimmedUtterance = utterance.trim()
    const utteranceTokens = trimmedUtterance.split(/\s+/).filter(Boolean)
    const normalizedCommand = utteranceTokens[0]?.toLowerCase() || ''
    const normalizedToolName = forcedToolName.toLowerCase()

    if (
      utteranceTokens.length < 2 ||
      (normalizedCommand !== '/tool' && normalizedCommand !== '/t') ||
      utteranceTokens[1]?.toLowerCase() !== normalizedToolName
    ) {
      return utterance
    }

    return utteranceTokens.slice(2).join(' ').trim()
  }

  private getRoutingDecision(forcedMode?: RoutingMode): {
    mode: RoutingMode
    route: RoutingRoute
    reason: string
  } {
    const mode = this.resolveLeonMode(forcedMode)

    if (mode === RoutingMode.Agent) {
      return { mode, route: this.routingRoutes.react, reason: 'agent_mode' }
    }

    if (mode === RoutingMode.Controlled) {
      return {
        mode,
        route: this.routingRoutes.controlled,
        reason: 'controlled_mode'
      }
    }

    return { mode, route: this.routingRoutes.controlled, reason: 'smart_default' }
  }

  private async runReAct(
    utterance: NLPUtterance,
    agentSkillName?: NLPSkill,
    forcedToolName?: string
  ): Promise<void> {
    LogHelper.title('NLU')
    LogHelper.info('Routing to ReAct...')
    this._currentResponseRoute = 'react'
    const agentSkillContext = agentSkillName
      ? await SkillDomainHelper.getAgentSkillExecutionContext(agentSkillName)
      : null

    if (agentSkillName && !agentSkillContext) {
      LogHelper.warning(
        `Agent Skill "${agentSkillName}" could not be loaded. Continuing without active Agent Skill context.`
      )
    }

    const reactDuty = new ReActLLMDuty({
      input: utterance,
      agentSkill: agentSkillContext,
      ...(forcedToolName ? { forcedToolName } : {})
    })
    await reactDuty.init()
    const reactResult = await reactDuty.execute()
    const output = reactResult?.output as unknown as string
    const reactData =
      reactResult?.data && typeof reactResult.data === 'object'
        ? (reactResult.data as Record<string, unknown>)
        : {}
    const hasExplicitMemoryWrite =
      reactData['hasExplicitMemoryWrite'] === true
    const llmMetrics =
      reactData['llmMetrics'] && typeof reactData['llmMetrics'] === 'object'
        ? (reactData['llmMetrics'] as Record<string, unknown>)
        : null
    const finalIntent =
      typeof reactData['finalIntent'] === 'string'
        ? (reactData['finalIntent'] as
            | 'answer'
            | 'clarification'
            | 'cancelled'
            | 'blocked'
            | 'error')
        : 'answer'
    const toolExecutions = Array.isArray(reactData['executionHistory'])
      ? (reactData['executionHistory'] as Array<Record<string, unknown>>)
          .map((item) => {
            const functionName =
              typeof item['function'] === 'string' ? item['function'] : ''
            const status = item['status'] === 'error' ? 'error' : 'success'
            const observation =
              typeof item['observation'] === 'string' ? item['observation'] : ''
            if (!functionName) {
              return null
            }

            return {
              functionName,
              status,
              observation
            }
          })
          .filter(
            (
              item
            ): item is {
              functionName: string
              status: 'success' | 'error'
              observation: string
            } => Boolean(item)
          )
      : []

    if (output) {
      const sentAt = Date.now()
      void MEMORY_MANAGER.observeTurn({
        userMessage: utterance,
        assistantMessage: String(output),
        sentAt,
        route: 'react',
        toolExecutions
      }).catch((error: unknown) => {
        LogHelper.title('NLU')
        LogHelper.warning(`Failed to store turn memory: ${error}`)
      })
      void SELF_MODEL_MANAGER.observeTurn({
        userMessage: utterance,
        assistantMessage: String(output),
        sentAt,
        route: 'react',
        finalIntent,
        toolExecutions
      }).catch((error: unknown) => {
        LogHelper.title('NLU')
        LogHelper.warning(`Failed to update self model: ${error}`)
      })
      void syncOwnerProfileFromTurn(
        utterance,
        String(output),
        toolExecutions
      ).catch((error: unknown) => {
        LogHelper.title('NLU')
        LogHelper.warning(`Failed to sync owner profile from turn: ${error}`)
      })

      if (!hasExplicitMemoryWrite) {
        void MEMORY_MANAGER.savePersistentMemoryCandidatesFromTurn(
          utterance,
          String(output),
          sentAt
        ).catch((error: unknown) => {
          LogHelper.title('NLU')
          LogHelper.warning(
            `Failed to save persistent memory candidates: ${error}`
          )
        })
      } else {
        LogHelper.title('NLU')
        LogHelper.debug(
          'Skipping automatic persistent extraction: explicit memory.write already executed in this turn'
        )
      }
    }

    if (output && !BRAIN.isMuted) {
      await BRAIN.talk(
        llmMetrics
          ? {
              text: String(output),
              speech: String(output),
              llmMetrics: {
                inputTokens: Number(llmMetrics['inputTokens'] || 0),
                outputTokens: Number(llmMetrics['outputTokens'] || 0),
                totalTokens: Number(llmMetrics['totalTokens'] || 0),
                finalAnswerOutputTokens: Number(
                  llmMetrics['finalAnswerOutputTokens'] || 0
                ),
                durationMs: Number(llmMetrics['durationMs'] || 0),
                finalAnswerDurationMs: Number(
                  llmMetrics['finalAnswerDurationMs'] || 0
                ),
                finalAnswerTokensPerSecond: Number(
                  llmMetrics['finalAnswerTokensPerSecond'] || 0
                ),
                finalAnswerCharsPerSecond: Number(
                  llmMetrics['finalAnswerCharsPerSecond'] || 0
                ),
                outputCharsPerSecond: Number(
                  llmMetrics['outputCharsPerSecond'] || 0
                ),
                averagedPhaseTokensPerSecond: Number(
                  llmMetrics['averagedPhaseTokensPerSecond'] || 0
                ),
                ...(llmMetrics['phaseMetrics'] &&
                typeof llmMetrics['phaseMetrics'] === 'object'
                  ? {
                      phaseMetrics: llmMetrics['phaseMetrics'] as {
                        planning: {
                          outputTokens: number
                          durationMs: number
                          tokensPerSecond: number
                        }
                        execution: {
                          outputTokens: number
                          durationMs: number
                          tokensPerSecond: number
                        }
                        recovery: {
                          outputTokens: number
                          durationMs: number
                          tokensPerSecond: number
                        }
                        final_answer: {
                          outputTokens: number
                          durationMs: number
                          tokensPerSecond: number
                        }
                      }
                    }
                  : {}),
                turnInputTokens: Number(llmMetrics['turnInputTokens'] || 0),
                turnOutputTokens: Number(llmMetrics['turnOutputTokens'] || 0),
                turnTotalTokens: Number(llmMetrics['turnTotalTokens'] || 0),
                ttftMs: Number(llmMetrics['ttftMs'] || 0),
                tokensPerSecond: Number(llmMetrics['tokensPerSecond'] || 0)
              }
            }
          : String(output),
        true
      )
    }
  }
  private async runSkillWriterCreateSkill(
    utterance: NLPUtterance
  ): Promise<void> {
    LogHelper.title('NLU')
    LogHelper.info('Routing to Skill Writer...')

    await NLUProcessResultUpdater.update({
      new: {
        utterance
      }
    })
    await NLUProcessResultUpdater.update({
      skillName: 'skill_writer_skill'
    })
    await NLUProcessResultUpdater.update({
      actionName: 'create_skill'
    })

    await this.handleActionSuccess({
      status: ActionCallingStatus.Success,
      name: 'create_skill',
      arguments: {}
    })
  }

  /**
   * Ready to execute skill action, then once executed, prioritize:
   *
   * 1. Handle explicit jump to another action.
   * This allows a skill to override any loop or workflow logic.
   * E.g., a "replay" action telling the core to jump back to the "set_up" action.
   *
   * 2. Handle action loop logic.
   * An action with "is_loop" will repeat by default.
   * It will only break if the skill's code returns { "core": { "isInActionLoop": false } }.
   *
   * 3. Handle standard workflow logic.
   * This runs if there's no jump and the loop has been broken (or was never a loop).
   *
   * 4. Clean up.
   * This is the default case when an interaction is complete:
   * - No jump was requested.
   * - A loop was successfully broken.
   * - The end of a workflow was reached (or there was no workflow).
   */
  private async handleActionSuccess(
    actionCallingOutput: ActionCallingSuccessOutput
  ): Promise<void> {
    this.workflowProgress.startAction(actionCallingOutput.name)

    await NLUProcessResultUpdater.update({
      new: {
        actionArguments: actionCallingOutput.arguments
      }
    })

    LogHelper.title('NLU')
    LogHelper.success(
      `Action calling succeeded for: ${actionCallingOutput.name}`
    )
    LogHelper.success(
      `NLU process result: ${JSON.stringify(this._nluProcessResult)}`
    )

    const processedData = await BRAIN.runSkillAction(this._nluProcessResult)

    if (processedData.core?.should_stop_skill) {
      LogHelper.title('NLU')
      LogHelper.info('Received stop skill signal')

      this.conversation.cleanActiveState()
      await NLUProcessResultUpdater.update(DEFAULT_NLU_PROCESS_RESULT)
      this.workflowProgress.completeAll()
      this.workflowProgress.reset()
      this.emitDeferredSkillWidget(processedData)

      return
    }

    if (processedData.core?.next_action) {
      this.workflowProgress.completeAll()
      this.emitDeferredSkillWidget(processedData)
      await this.jumpToNextAction(processedData.core.next_action)

      return
    }

    const { skillConfig, actionName: currentActionName } =
      this._nluProcessResult
    const currentActionConfig = this._nluProcessResult.actionConfig
    const isLoop = currentActionConfig?.is_loop === true
    const shouldBreakLoop = processedData.core?.is_in_action_loop === false
    if (isLoop && !shouldBreakLoop) {
      LogHelper.title('NLU')
      LogHelper.info(
        `Action "${currentActionName}" is in a loop. Waiting for next owner input...`
      )

      this.conversation.setActiveState({
        ...this.conversation.activeState,
        pendingAction: `${this._nluProcessResult.skillName}:${currentActionName}`,
        // Repopulate missingParameters with ALL parameters for this action
        missingParameters: this.getRequiredParamsForAction(currentActionConfig),
        // Clear collected parameters for the new loop iteration
        collectedParameters: {}
      })

      /**
       * By returning here, we do not advance the workflow.
       * The current action remains and ready for the next user input
       */
      this.workflowProgress.completeAll()
      this.workflowProgress.reset()
      this.emitDeferredSkillWidget(processedData)
      return
    }

    const { workflow } = skillConfig
    const hasWorkflow = workflow && workflow.length > 0
    if (hasWorkflow) {
      const shouldContinueWorkflow = await this.handleSkillWorkflow(workflow)

      if (shouldContinueWorkflow) {
        this.emitDeferredSkillWidget(processedData)
        return
      }
    }

    /**
     * If there is no workflow or the workflow has ended,
     * clean the state for the next utterance
     */
    this.conversation.cleanActiveState()
    await NLUProcessResultUpdater.update(DEFAULT_NLU_PROCESS_RESULT)
    this.workflowProgress.completeAll()
    this.workflowProgress.reset()
    this.emitDeferredSkillWidget(processedData)
  }

  private async handleActionMissingParams(
    actionCallingOutput: ActionCallingMissingParamsOutput
  ): Promise<void> {
    this.workflowProgress.completeAll()

    LogHelper.title('NLU')
    LogHelper.warning(
      `Action calling missing params for: ${actionCallingOutput.name}`
    )

    /**
     * Ask owner to provide the missing parameters
     */

    this.conversation.setActiveState({
      pendingAction: `${this._nluProcessResult.skillName}:${actionCallingOutput.name}`,
      missingParameters: actionCallingOutput.required_params,
      collectedParameters: {
        ...this.conversation.activeState.collectedParameters,
        ...actionCallingOutput.arguments
      }
    })

    const [firstParam] = actionCallingOutput.required_params
    const formattedFirstParam = firstParam?.replace(/_/g, ' ')

    if (!BRAIN.isMuted) {
      await BRAIN.talk(
        `${BRAIN.wernicke('ask_for_action_missing_parameters', '', {
          '{{ missing_param }}': formattedFirstParam
        })}.`,
        true
      )
    }

    this.workflowProgress.reset()
  }

  /**
   * Route before processing the utterance
   */
  private async preProcessRoute(): Promise<boolean> {
    const hasPendingAction = this.conversation.hasPendingAction()

    if (hasPendingAction) {
      this.workflowProgress.showResolvingParameters()
      const [slotName] = this.conversation.activeState.missingParameters
      const actionConfig = this._nluProcessResult.actionConfig
      const param = actionConfig?.parameters?.[slotName as string]
      const paramDescription = param.description || ''
      const slotFillingDuty = new SlotFillingLLMDuty({
        // Only one slot at a time
        input: {
          slotName: slotName as string,
          slotDescription: paramDescription,
          slotType: param.type || 'string',
          latestUtterance: this._nluProcessResult.new.utterance || '',
          recentUtterances: this._nluProcessResult.context.utterances.slice(-4)
        },
        startingUtterance: this.conversation.activeState
          .startingUtterance as string
      })

      await slotFillingDuty.init()

      const slotFillingResult = await slotFillingDuty.execute()
      if (!slotFillingResult) {
        await this.handleProviderFailure()
        return false
      }

      const slotFillingOutput =
        slotFillingResult?.output as unknown as SlotFillingOutput

      if ('status' in slotFillingOutput) {
        if (slotFillingOutput.status === SlotFillingStatus.Success) {
          // Update missing parameters and fill slots
          const updatedMissingParams =
            this.conversation.activeState.missingParameters.filter(
              (param) =>
                !Object.keys(slotFillingOutput.filled_slots).includes(param)
            )
          const newActiveState = {
            ...this.conversation.activeState,
            missingParameters: updatedMissingParams,
            collectedParameters: {
              ...this.conversation.activeState.collectedParameters,
              ...slotFillingOutput.filled_slots
            }
          }
          this.conversation.setActiveState(newActiveState)

          const areAllSlotsFilled =
            updatedMissingParams.length === 0 &&
            Object.keys(newActiveState.collectedParameters).length > 0
          const actionName = newActiveState.pendingAction?.split(':')[1] || ''

          if (areAllSlotsFilled) {
            await this.handleActionSuccess({
              status: ActionCallingStatus.Success,
              name: actionName,
              arguments: newActiveState.collectedParameters
            })

            return false
          }

          LogHelper.title('NLU')
          LogHelper.info(
            `Not all slots are filled, remaining: ${JSON.stringify(
              updatedMissingParams
            )}`
          )

          /**
           * Not all slots are filled hence,
           * we need to ask again the owner for the remaining missing parameters
           */
          await this.handleActionMissingParams({
            status: ActionCallingStatus.MissingParams,
            required_params: newActiveState.missingParameters,
            name: actionName,
            arguments: newActiveState.collectedParameters
          })

          return false
        }

        /**
         * In case the owner does not provide the missing parameters/slots,
         * then we continue the skill -> action calling process
         */
        return true
      }

      return false
    }

    // We are in a fresh state, hence, we can set the starting utterance
    this.conversation.setActiveState({
      ...this.conversation.activeState,
      startingUtterance: this._nluProcessResult.new.utterance as NLPUtterance
    })

    return true
  }

  /**
   * Route the action calling output based on its status
   * and handle the action calling result accordingly
   */
  private async postProcessRoute(
    actionCallingOutput: ActionCallingOutput
  ): Promise<void> {
    if ('name' in actionCallingOutput) {
      await NLUProcessResultUpdater.update({
        actionName: actionCallingOutput.name
      })
    }

    const routeMap = {
      [ActionCallingStatus.Success]: (): Promise<void> => {
        return this.handleActionSuccess(
          actionCallingOutput as ActionCallingSuccessOutput
        )
      },
      [ActionCallingStatus.MissingParams]: (): Promise<void> => {
        return this.handleActionMissingParams(
          actionCallingOutput as ActionCallingMissingParamsOutput
        )
      },
      [ActionCallingStatus.NotFound]: (): Promise<void> => {
        return this.handleSkillOrActionNotFound()
      }
    }

    const actionStatus = actionCallingOutput.status as ActionCallingStatus
    if (routeMap[actionStatus]) {
      LogHelper.title('NLU')
      LogHelper.info(`Routing action calling status: ${actionStatus}`)

      await routeMap[actionStatus]()
    } else {
      LogHelper.title('NLU')
      LogHelper.error(`Unknown action calling status: ${actionStatus}`)
    }
  }

  /**
   * Classify the utterance,
   * pick up the right classification
   * and extract entities
   */
  public process(
    utterance: NLPUtterance,
    options?: {
      ownerMessageId?: string
      forcedRoutingMode?: RoutingMode
      forcedSkillName?: NLPSkill
      forcedToolName?: string
    }
  ): Promise<NLUPartialProcessResult | null> {
    // TODO: core rewrite
    // const processingTimeStart = Date.now()

    return TOOL_CALL_LOGGER.runOwnerQuery(
      utterance,
      async () =>
        new Promise(async (resolve, reject) => {
          try {
            LogHelper.title('NLU')
            LogHelper.info('Processing...')
            this.hasHandledProviderFailure = false
            const workflowUtterance = this.getWorkflowUtterance(
              utterance,
              options?.forcedSkillName
            )
            const toolUtterance = this.getToolUtterance(
              utterance,
              options?.forcedToolName
            )

            await CONVERSATION_LOGGER.push({
              who: 'owner',
              message: utterance,
              isAddedToHistory: true,
              ...(options?.ownerMessageId
                ? { messageId: options.ownerMessageId }
                : {})
            })
            const currentSessionId =
              CONVERSATION_SESSION_MANAGER.getCurrentSessionId()
            CONVERSATION_SESSION_MANAGER.maybeSetFallbackTitle(
              currentSessionId,
              utterance
            )
            CONVERSATION_SESSION_MANAGER.generateTitleFromFirstMessage(
              currentSessionId,
              utterance
            )
            void PULSE_MANAGER.observeOwnerUtterance(utterance).catch(
              (error: unknown) => {
                LogHelper.title('NLU')
                LogHelper.warning(
                  `Failed to observe pulse owner feedback: ${error}`
                )
              }
            )

            await NLUProcessResultUpdater.update({
              new: {
                utterance: workflowUtterance
              }
            })

            const handledWorkflowNotFoundChoice =
              await this.handlePendingWorkflowNotFoundChoice(utterance)
            if (this.hasHandledProviderFailure) {
              return resolve(null)
            }
            if (handledWorkflowNotFoundChoice) {
              return resolve(null)
            }

            const routingDecision = this.getRoutingDecision(
              options?.forcedRoutingMode
            )
            LogHelper.title('NLU')
            LogHelper.info(
              `Routing decision: mode=${routingDecision.mode} route=${routingDecision.route} reason=${routingDecision.reason}`
            )

            this._currentResponseRoute = routingDecision.route
            const modelState = CONFIG_STATE.getModelState()
            const isLLMDisabledForRoute =
              (routingDecision.route === this.routingRoutes.react &&
                !modelState.getAgentTarget().isEnabled) ||
              (routingDecision.route === this.routingRoutes.controlled &&
                !modelState.getWorkflowTarget().isEnabled)

            if (isLLMDisabledForRoute) {
              await this.handleProviderFailure(NO_LLM_ENABLED_MESSAGE)
              return resolve(null)
            }
            this.startWorkflowProgressForTurn(
              routingDecision.mode,
              this.conversation.hasPendingAction()
            )
            PERSONA.refreshContextInfo()
            if (routingDecision.route === this.routingRoutes.react) {
              this.workflowProgress.reset()
              this.conversation.cleanActiveState()
              await NLUProcessResultUpdater.update(DEFAULT_NLU_PROCESS_RESULT)
              const forcedSkillDescriptor = options?.forcedSkillName
                ? SkillDomainHelper.getSkillDescriptorSync(
                    options.forcedSkillName
                  )
                : null
              const forcedAgentSkillName =
                forcedSkillDescriptor?.format === SkillFormat.AgentSkill
                  ? options?.forcedSkillName
                  : undefined

              await this.runReAct(
                forcedAgentSkillName ? workflowUtterance : toolUtterance,
                forcedAgentSkillName,
                options?.forcedToolName
              )
              return resolve(null)
            }

            const shouldPickSkillAction = await this.preProcessRoute()
            if (this.hasHandledProviderFailure) {
              return resolve(null)
            }

            if (shouldPickSkillAction) {
              let chosenSkill = options?.forcedSkillName || null

              if (!chosenSkill) {
                this.workflowProgress.showChoosingSkill()
                chosenSkill = await this.chooseSkill(workflowUtterance)
                if (this.hasHandledProviderFailure) {
                  this.workflowProgress.reset()
                  return resolve(null)
                }
              }

              const isSkillFound = !!chosenSkill

              if (!isSkillFound) {
                if (routingDecision.mode === RoutingMode.Smart) {
                  this.workflowProgress.completeRoutingOnly()
                  this.workflowProgress.reset()
                  await this.runReAct(utterance)
                  return resolve(null)
                }

                await this.handleSkillOrActionNotFound()
                return
              }

              const resolvedSkill = chosenSkill as string

              await NLUProcessResultUpdater.update({
                skillName: resolvedSkill
              })
              this.workflowProgress.showPickingAction()

              const parsedActionCallingOutputs = await this.chooseSkillAction(
                workflowUtterance,
                resolvedSkill
              )
              if (this.hasHandledProviderFailure) {
                this.workflowProgress.reset()
                return resolve(null)
              }

              if (
                parsedActionCallingOutputs &&
                Array.isArray(parsedActionCallingOutputs) &&
                parsedActionCallingOutputs.length > 0
              ) {
                for (const actionCallingOutput of parsedActionCallingOutputs) {
                  if ('status' in actionCallingOutput) {
                    await this.postProcessRoute(actionCallingOutput)
                  }
                }

                return
              }
            }

            // TODO: handle error in action calling

            try {
              return resolve({})
            } catch (e) {
              const errorMessage = `Failed to execute action: ${e}`

              LogHelper.error(errorMessage)

              if (!BRAIN.isMuted) {
                SOCKET_SERVER.emitToChatClients('is-typing', false)
              }

              return reject(new Error(errorMessage))
            }
          } catch (e) {
            LogHelper.title('NLU')
            LogHelper.error(`Failed to process the utterance: ${e}`)
          }
        })
    )
  }
}
