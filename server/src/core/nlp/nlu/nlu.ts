import type {
  NLPSkill,
  NLPUtterance,
  NLUPartialProcessResult,
  NLUProcessResult,
  NLUResult
} from '@/core/nlp/types'
import type { SkillSchema } from '@/schemas/skill-schemas'
import type { SkillAnswerCoreData } from '@/core/brain/types'
import {
  type ActionCallingMissingParamsOutput,
  type ActionCallingOutput,
  ActionCallingStatus,
  type ActionCallingSuccessOutput,
  type SlotFillingOutput,
  SlotFillingStatus
} from '@/core/llm-manager/types'
import { BRAIN, CONVERSATION_LOGGER, SOCKET_SERVER } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import Conversation from '@/core/nlp/conversation'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import {
  DEFAULT_NLU_PROCESS_RESULT,
  NLUProcessResultUpdater
} from '@/core/nlp/nlu/nlu-process-result-updater'
import { SkillRouterLLMDuty } from '@/core/llm-manager/llm-duties/skill-router-llm-duty'
import { ActionCallingLLMDuty } from '@/core/llm-manager/llm-duties/action-calling-llm-duty'
import { SlotFillingLLMDuty } from '@/core/llm-manager/llm-duties/slot-filling-llm-duty'

// TODO: core rewrite delete?
/*type MatchActionResult = Pick<
  NLPJSProcessResult,
  'locale' | 'sentiment' | 'answers' | 'intent' | 'domain' | 'score'
>*/

// TODO: delete?
export const DEFAULT_NLU_RESULT = {
  utterance: '',
  newUtterance: '',
  currentEntities: [],
  entities: [],
  currentResolvers: [],
  resolvers: [],
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

export default class NLU {
  private static instance: NLU
  // Used to store the current single-turn NLU process result
  private _nluProcessResult = DEFAULT_NLU_PROCESS_RESULT
  private _nluResult: NLUResult = DEFAULT_NLU_RESULT
  // Used to store the conversation state (across multiple turns)
  public conversation = new Conversation('conv0')

  get nluProcessResult(): NLUProcessResult {
    return this._nluProcessResult
  }

  set nluProcessResult(newResult: NLUProcessResult) {
    this._nluProcessResult = newResult
  }

  get nluResult(): NLUResult {
    return this._nluResult
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

    const skillConfigPath = newNLUResult.skillConfigPath
      ? newNLUResult.skillConfigPath
      : SkillDomainHelper.getSkillConfigPath(
          newNLUResult.classification.domain,
          newNLUResult.classification.skill,
          BRAIN.lang
        )
    const { actions } = await SkillDomainHelper.getSkillConfig(
      skillConfigPath,
      BRAIN.lang
    )

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

  // TODO: core rewrite delete?
  /**
   * Check if the utterance should break the action loop
   * based on the active context and the utterance content
   */
  /*private shouldBreakActionLoop(utterance: NLPUtterance): boolean {
    const loopStopWords = LangHelper.getActionLoopStopWords(BRAIN.lang)
    const hasActiveContext = this.conversation.hasActiveContext()
    const hasOnlyOneWord = utterance.split(' ').length === 1
    const hasLessThan5Words = utterance.split(' ').length < 5
    const hasStopWords = loopStopWords.some((word) =>
      utterance.toLowerCase().includes(word)
    )
    const hasLoopWord = utterance.toLowerCase().includes('loop')

    if (
      (hasActiveContext && hasStopWords && hasOnlyOneWord) ||
      (hasLessThan5Words && hasStopWords && hasLoopWord)
    ) {
      LogHelper.title('NLU')
      LogHelper.info('Should break action loop')
      return true
    }

    return false
  }*/

  // TODO: core rewrite delete?
  /**
   * Set new language; recreate a new TCP server with new language; and reprocess understanding
   */
  /*private async switchLanguage(
    utterance: NLPUtterance,
    locale: ShortLanguageCode
  ): Promise<void> {
    const connectedHandler = async (): Promise<void> => {
      await this.process(utterance)
    }

    BRAIN.lang = locale
    await BRAIN.talk(`${BRAIN.wernicke('random_language_switch')}.`, true)

    // Recreate a new TCP server process and reconnect the TCP client
    kill(global.pythonTCPServerProcess.pid as number, () => {
      global.pythonTCPServerProcess = spawn(
        `${PYTHON_TCP_SERVER_BIN_PATH} ${locale}`,
        {
          shell: true
        }
      )

      PYTHON_TCP_CLIENT.connect()
      PYTHON_TCP_CLIENT.ee.removeListener('connected', connectedHandler)
      PYTHON_TCP_CLIENT.ee.on('connected', connectedHandler)
    })
  }*/

  // TODO: core rewrite delete?
  /**
   * Match the action based on the utterance.
   * Fallback to chat action if no action is found
   */
  /*private async matchAction(
    utterance: NLPUtterance
  ): Promise<MatchActionResult> {
    const socialConversationDomain = 'social_communication'
    const chitChatSetupIntent = 'conversation.setup'
    const nbWords = utterance.split(' ').length
    /!**
     * If considered as long utterance then force conversation.converse intent.
     * Should go straight to the point when asking for a specific action without saying
     * too much
     *!/
    const isConsideredLongUtterance = nbWords >= 12
    let locale = null as unknown as NLPJSProcessResult['locale']
    let sentiment
    let answers = null as unknown as NLPJSProcessResult['answers']
    let intent = null as unknown as NLPJSProcessResult['intent']
    let domain = null as unknown as NLPJSProcessResult['domain']
    let score = 1
    let classifications =
      null as unknown as NLPJSProcessResult['classifications']
    let ownerHasExplicitlyRequestedChitChat = false

    /!**
     * Check if the owner has explicitly requested the chit-chat loop
     *!/
    const mainClassifierResult =
      await MODEL_LOADER.mainNLPContainer.process(utterance)
    if (
      mainClassifierResult.domain === socialConversationDomain &&
      mainClassifierResult.intent === chitChatSetupIntent
    ) {
      ownerHasExplicitlyRequestedChitChat = true
    }

    if (
      LLM_MANAGER.isLLMActionRecognitionEnabled &&
      !ownerHasExplicitlyRequestedChitChat
    ) {
      /!**
       * Use LLM for action recognition
       *!/

      const dutyParams: ActionRecognitionLLMDutyParams = {
        input: utterance,
        data: {
          existingContextName: null
        }
      }

      if (this.conversation.hasActiveContext()) {
        dutyParams.data.existingContextName =
          this.conversation.activeContext.name
      }

      const actionRecognitionDuty = new ActionRecognitionLLMDuty(dutyParams)
      await actionRecognitionDuty.init()
      const actionRecognitionResult = await actionRecognitionDuty.execute()
      const foundAction = actionRecognitionResult?.output[
        'intent_name'
      ] as string

      locale = await MODEL_LOADER.mainNLPContainer.guessLanguage(utterance)
      ;({ sentiment } =
        await MODEL_LOADER.mainNLPContainer.getSentiment(utterance))

      const chitChatSetupAction = `${socialConversationDomain}.${chitChatSetupIntent}`
      /!**
       * Check if the LLM did not find any action.
       * Ignore the chit-chat setup action as it is a special case
       *!/
      const llmActionRecognitionDidNotFindAction =
        isConsideredLongUtterance ||
        !foundAction ||
        foundAction === 'not_found' ||
        foundAction === chitChatSetupAction
      if (llmActionRecognitionDidNotFindAction) {
        Telemetry.utterance({ utterance, lang: BRAIN.lang })

        domain = socialConversationDomain
        intent = 'conversation.converse'
      } else {
        // Check in case the LLM hallucinated an action
        const actionExists = await SkillDomainHelper.actionExists(
          locale,
          foundAction
        )

        if (!actionExists) {
          Telemetry.utterance({ utterance, lang: BRAIN.lang })

          domain = socialConversationDomain
          intent = 'conversation.converse'
        } else {
          const parsedAction = foundAction.split('.')
          const [, skillName, actionName] = parsedAction

          domain = parsedAction[0] as string
          intent = `${skillName}.${actionName}`
          answers = await MODEL_LOADER.mainNLPContainer.findAllAnswers(
            locale,
            intent
          )
        }
      }
    } else {
      /!**
       * Use classic NLP processing
       *!/

      ;({ locale, answers, score, intent, domain, sentiment, classifications } =
        await MODEL_LOADER.mainNLPContainer.process(utterance))

      /!**
       * If a context is active, then use the appropriate classification based on score probability.
       * E.g. 1. Create my shopping list; 2. Actually delete it.
       * If there are several "delete it" across skills, Leon needs to make use of
       * the current context ({domain}.{skill}) to define the most accurate classification
       *!/
      if (this.conversation.hasActiveContext()) {
        classifications.forEach(({ intent: newIntent, score: newScore }) => {
          if (newScore > 0.6) {
            const [skillName] = newIntent.split('.')
            const newDomain = MODEL_LOADER.mainNLPContainer.getIntentDomain(
              locale,
              newIntent
            )
            const contextName = `${newDomain}.${skillName}`
            if (this.conversation.activeContext.name === contextName) {
              score = newScore
              intent = newIntent
              domain = newDomain
            }
          }
        })
      }
    }

    return { locale, sentiment, answers, intent, domain, score }
  }*/

  private async chooseSkill(utterance: NLPUtterance): Promise<NLPSkill | null> {
    LogHelper.title('NLU')
    LogHelper.info('Choosing skill...')

    try {
      const skillRouterDuty = new SkillRouterLLMDuty({
        input: utterance
      })

      await skillRouterDuty.init()

      const skillRouterResult = await skillRouterDuty.execute()
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
      const actionCallingDuty = new ActionCallingLLMDuty({
        input: utterance,
        skillName
      })

      await actionCallingDuty.init()

      const actionCallingResult = await actionCallingDuty.execute()
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

          SOCKET_SERVER.socket?.emit('suggest', suggestions)
        }
      }
    } catch (e) {
      LogHelper.title('NLU')
      LogHelper.error(`Failed to send suggestions: ${e}`)
    }
  }

  private async handleSkillFlow(flow: SkillSchema['flow']): Promise<boolean> {
    if (flow) {
      LogHelper.title('NLU')
      LogHelper.info('Handling skill flow...')

      try {
        const currentAction = this._nluProcessResult.actionName
        const currentActionIndex = flow.indexOf(currentAction)
        const isLastActionInFlow = currentActionIndex === flow.length - 1

        /**
         * If the current action is not the last one in the flow,
         * prepare the next action
         */
        if (!isLastActionInFlow) {
          const nextActionName = flow[currentActionIndex + 1] as string

          if (nextActionName.includes(':')) {
            // This is a cross-skill action call
            const [crossSkillName] = nextActionName.split(':')
            const originalSkillName = this._nluProcessResult.skillName

            await this.jumpToNextAction(nextActionName)

            // After cross-skill action completes, return to original skill and continue flow
            if (crossSkillName !== originalSkillName) {
              // Continue with the remaining actions in the flow (after the cross-skill call)
              const remainingFlow = flow.slice(currentActionIndex + 2)
              const isRemainingFlowNotDone = remainingFlow.length > 0

              if (isRemainingFlowNotDone) {
                const nextOriginalAction = remainingFlow[0] as string

                await NLUProcessResultUpdater.update({
                  skillName: originalSkillName,
                  actionName: nextOriginalAction
                })

                return await this.handleSkillFlow(remainingFlow)
              }

              // No more actions in flow, clean up
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
           * If the next action in the flow has no parameters, execute it immediately
           * without waiting for another user input. E.g., the "set_up" action
           */
          if (this.getRequiredParamsForAction(nextActionConfig).length === 0) {
            await this.handleActionSuccess({
              status: ActionCallingStatus.Success,
              name: nextActionName,
              arguments: {}
            })
          } else {
            await this.sendSuggestions()
          }

          return true
        }

        return false
      } catch (e) {
        LogHelper.title('NLU')
        LogHelper.error(`Failed to handle skill flow: ${e}`)
      }
    }

    return false
  }

  private async handleSkillOrActionNotFound(): Promise<void> {
    LogHelper.title('NLU')
    LogHelper.warning('Skill or action not found')

    this.conversation.cleanActiveState()
    await NLUProcessResultUpdater.update(DEFAULT_NLU_PROCESS_RESULT)

    // TODO: core rewrite chit-chat duty / or conversation skill?
  }

  /**
   * Ready to execute skill action, then once executed, prioritize:
   *
   * 1. Handle explicit jump to another action.
   * This allows a skill to override any loop or flow logic.
   * E.g., a "replay" action telling the core to jump back to the "set_up" action.
   *
   * 2. Handle action loop logic.
   * An action with "is_loop" will repeat by default.
   * It will only break if the skill's code returns { "core": { "isInActionLoop": false } }.
   *
   * 3. Handle standard flow logic.
   * This runs if there's no jump and the loop has been broken (or was never a loop).
   *
   * 4. Clean up.
   * This is the default case when an interaction is complete:
   * - No jump was requested.
   * - A loop was successfully broken.
   * - The end of a flow was reached (or there was no flow).
   */
  private async handleActionSuccess(
    actionCallingOutput: ActionCallingSuccessOutput
  ): Promise<void> {
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

    console.log('processedData', processedData)
    console.log('this._nluProcessResult', this._nluProcessResult)

    if (processedData.core?.next_action) {
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
       * By returning here, we do not advance the flow.
       * The current action remains and ready for the next user input
       */
      return
    }

    const { flow } = skillConfig
    const hasFlow = flow && flow.length > 0
    if (hasFlow) {
      const shouldContinueFlow = await this.handleSkillFlow(flow)

      if (shouldContinueFlow) {
        return
      }
    }

    /**
     * If there is no flow or the flow has ended,
     * clean the state for the next utterance
     */
    this.conversation.cleanActiveState()
    await NLUProcessResultUpdater.update(DEFAULT_NLU_PROCESS_RESULT)
  }

  private async handleActionMissingParams(
    actionCallingOutput: ActionCallingMissingParamsOutput
  ): Promise<void> {
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
  }

  /**
   * Route before processing the utterance
   */
  private async preProcessRoute(): Promise<boolean> {
    const hasPendingAction = this.conversation.hasPendingAction()

    if (hasPendingAction) {
      const [slotName] = this.conversation.activeState.missingParameters
      const actionConfig = this._nluProcessResult.actionConfig
      const param = actionConfig?.parameters?.[slotName as string]
      const paramDescription = param.description || ''
      const slotFillingDuty = new SlotFillingLLMDuty({
        // Only one slot at a time
        input: {
          slotName: slotName as string,
          slotDescription: paramDescription,
          slotType: param.type
        },
        startingUtterance: this.conversation.activeState
          .startingUtterance as string
      })

      await slotFillingDuty.init()

      const slotFillingResult = await slotFillingDuty.execute()
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
    utterance: NLPUtterance
  ): Promise<NLUPartialProcessResult | null> {
    // TODO: core rewrite
    // const processingTimeStart = Date.now()

    return new Promise(async (resolve, reject) => {
      try {
        LogHelper.title('NLU')
        LogHelper.info('Processing...')

        await CONVERSATION_LOGGER.push({
          who: 'owner',
          message: utterance
        })

        await NLUProcessResultUpdater.update({
          new: {
            utterance
          }
        })

        const shouldPickSkillAction = await this.preProcessRoute()

        if (shouldPickSkillAction) {
          const chosenSkill = await this.chooseSkill(utterance)
          const isSkillFound = !!chosenSkill

          if (!isSkillFound) {
            await this.handleSkillOrActionNotFound()
            return
          }

          await NLUProcessResultUpdater.update({
            skillName: chosenSkill
          })

          const parsedActionCallingOutputs = await this.chooseSkillAction(
            utterance,
            chosenSkill
          )

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

        // TODO: core rewrite (need to measure processing time)
        /*const processingTimeEnd = Date.now()
        const processingTime = processingTimeEnd - processingTimeStart

        resolve({
          processingTime, // In ms, total time
          ...processedData,
          newUtterance: utterance,
          nluProcessingTime:
            processingTime - (processedData?.executionTime || 0) // In ms, NLU processing time only
        })*/

        //////////////////////////////////

        // TODO: core rewrite delete?
        /*if (!MODEL_LOADER.hasNlpModels()) {
          if (!BRAIN.isMuted) {
            await BRAIN.talk(`${BRAIN.wernicke('random_errors')}!`)
          }

          const msg =
            'An NLP model is missing, please rebuild the project or if you are in dev run: npm run train'
          LogHelper.error(msg)
          return reject(msg)
        }

        if (this.shouldBreakActionLoop(utterance)) {
          this.conversation.cleanActiveContext()

          await BRAIN.talk(`${BRAIN.wernicke('action_loop_stopped')}.`, true)

          return resolve({})
        }

        // Add spaCy entities
        await NER.mergeSpacyEntities(utterance)

        // Pre NLU processing according to the active context if there is one
        if (this.conversation.hasActiveContext()) {
          // When the active context is in an action loop, then directly trigger the action
          if (this.conversation.activeContext.isInActionLoop) {
            return resolve(await ActionLoop.handle(utterance))
          }

          // When the active context has slots filled
          if (Object.keys(this.conversation.activeContext.slots).length > 0) {
            try {
              return resolve(await SlotFilling.handle(utterance))
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (e) {
              return reject({})
            }
          }
        }

        const { locale, sentiment, answers, intent, domain, score } =
          await this.matchAction(utterance)

        const [skillName, actionName] = intent.split('.')

        await this.setNLUResult({
          ...DEFAULT_NLU_RESULT, // Reset entities, slots, etc.
          utterance,
          newUtterance: utterance,
          answers, // For dialog action type
          sentiment,
          classification: {
            domain,
            skill: skillName || '',
            action: actionName || '',
            confidence: score
          }
        })

        const isSupportedLanguage = LangHelper.getShortCodes().includes(locale)
        if (!isSupportedLanguage) {
          await BRAIN.talk(
            `${BRAIN.wernicke('random_language_not_supported')}.`,
            true
          )
          return resolve({})
        }

        // Trigger language switching
        if (BRAIN.lang !== locale) {
          await this.switchLanguage(utterance, locale)
          return resolve(null)
        }

        if (intent === 'None') {
          const fallback = this.fallback(
            LANG_CONFIGS[LangHelper.getLongCode(locale)].fallbacks
          )

          if (!fallback) {
            if (!BRAIN.isMuted) {
              await BRAIN.talk(
                `${BRAIN.wernicke('random_unknown_intents_legacy')}.`,
                true
              )
            }

            LogHelper.title('NLU')
            const msg = 'Intent not found'
            LogHelper.warning(msg)

            Telemetry.utterance({ utterance, lang: BRAIN.lang })

            return resolve(null)
          }

          await this.setNLUResult(fallback)
        }

        LogHelper.title('NLU')
        LogHelper.success(
          `Intent found: ${this._nluResult.classification.skill}.${
            this._nluResult.classification.action
          } (domain: ${
            this._nluResult.classification.domain
          }); Confidence: ${this._nluResult.classification.confidence.toFixed(
            2
          )}`
        )

        const skillConfigPath = SkillDomainHelper.getSkillConfigPath(
          this._nluResult.classification.domain,
          this._nluResult.classification.skill,
          BRAIN.lang
        )
        this._nluResult.skillConfigPath = skillConfigPath

        try {
          this._nluResult.entities = await NER.extractEntities(
            BRAIN.lang,
            skillConfigPath,
            this._nluResult
          )
        } catch (e) {
          LogHelper.error(`Failed to extract entities: ${e}`)
        }

        const shouldSlotLoop = await SlotFilling.route(intent, utterance)
        if (shouldSlotLoop) {
          return resolve({})
        }

        // In case all slots have been filled in the first utterance
        if (
          this.conversation.hasActiveContext() &&
          Object.keys(this.conversation.activeContext.slots).length > 0
        ) {
          try {
            return resolve(await SlotFilling.handle(utterance))
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            return reject({})
          }
        }

        const newContextName = `${this._nluResult.classification.domain}.${skillName}`
        if (this.conversation.activeContext.name !== newContextName) {
          this.conversation.cleanActiveContext()
        }
        await this.conversation.setActiveContext({
          ...DEFAULT_ACTIVE_CONTEXT,
          lang: BRAIN.lang,
          slots: {},
          isInActionLoop: false,
          originalUtterance: this._nluResult.utterance,
          newUtterance: utterance,
          skillConfigPath: this._nluResult.skillConfigPath,
          actionName: this._nluResult.classification.action,
          domain: this._nluResult.classification.domain,
          intent,
          entities: this._nluResult.entities
        })
        // Pass current utterance entities to the NLU result object
        this._nluResult.currentEntities =
          this.conversation.activeContext.currentEntities
        // Pass context entities to the NLU result object
        this._nluResult.entities = this.conversation.activeContext.entities*/

        try {
          return resolve({})
          // TODO: core rewrite
          /*const processedData = await BRAIN.execute(this._nluResult)

          // Prepare next action if there is one queuing
          if (processedData.nextAction) {
            this.conversation.cleanActiveContext()
            await this.conversation.setActiveContext({
              ...DEFAULT_ACTIVE_CONTEXT,
              lang: BRAIN.lang,
              slots: {},
              isInActionLoop: !!processedData.nextAction.loop,
              originalUtterance: processedData.utterance ?? '',
              newUtterance: utterance ?? '',
              skillConfigPath: processedData.skillConfigPath || '',
              actionName: processedData.action?.next_action || '',
              domain: processedData.classification?.domain || '',
              intent: `${processedData.classification?.skill}.${processedData.action?.next_action}`,
              entities: []
            })
          }

          const processingTimeEnd = Date.now()
          const processingTime = processingTimeEnd - processingTimeStart

          return resolve({
            processingTime, // In ms, total time
            ...processedData,
            newUtterance: utterance,
            nluProcessingTime:
              processingTime - (processedData?.executionTime || 0) // In ms, NLU processing time only
          })*/
        } catch (e) {
          const errorMessage = `Failed to execute action: ${e}`

          LogHelper.error(errorMessage)

          if (!BRAIN.isMuted) {
            SOCKET_SERVER.socket?.emit('is-typing', false)
          }

          return reject(new Error(errorMessage))
        }
      } catch (e) {
        LogHelper.title('NLU')
        LogHelper.error(`Failed to process the utterance: ${e}`)
      }
    })
  }

  // TODO: core rewrite delete?
  /**
   * Pickup and compare the right fallback
   * according to the wished skill action
   */
  /*private fallback(fallbacks: Language['fallbacks']): NLUResult | null {
    const words = this._nluResult.utterance.toLowerCase().split(' ')

    if (fallbacks.length > 0) {
      LogHelper.info('Looking for fallbacks...')
      const tmpWords = []

      for (let i = 0; i < fallbacks.length; i += 1) {
        for (let j = 0; j < fallbacks[i]!.words.length; j += 1) {
          if (words.includes(fallbacks[i]!.words[j] as string)) {
            tmpWords.push(fallbacks[i]?.words[j])
          }
        }

        if (JSON.stringify(tmpWords) === JSON.stringify(fallbacks[i]?.words)) {
          this._nluResult.entities = []
          this._nluResult.classification.domain = fallbacks[i]
            ?.domain as NLPDomain
          this._nluResult.classification.skill = fallbacks[i]?.skill as NLPSkill
          this._nluResult.classification.action = fallbacks[i]
            ?.action as NLPAction
          this._nluResult.classification.confidence = 1

          LogHelper.success('Fallback found')
          return this._nluResult
        }
      }
    }

    return null
  }*/
}
