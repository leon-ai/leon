import type { NLUProcessResult } from '@/core/nlp/types'
import type { BrainProcessResult } from '@/core/brain/types'
import type { SkillAnswerConfigSchema } from '@/schemas/skill-schemas'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import { BRAIN } from '@/core'

const PLACEHOLDER_REGEX = /{{(.*?)}}/

export class DialogActionSkillHandler {
  public static async handle(
    nluProcessResult: NLUProcessResult,
    utteranceId: string
  ): Promise<Partial<BrainProcessResult>> {
    return new Promise((resolve) => {
      /**
       * For dialog skills, we consider that answers are always arrays of strings,
       * cause there is no need for object answers here
       */
      let answers = nluProcessResult.actionConfig?.answers as
        | SkillAnswerConfigSchema[]
        | undefined

      if (!answers || answers.length === 0) {
        LogHelper.title('Dialog Action Skill Handler')
        LogHelper.error(
          `No answers found for the action "${nluProcessResult.actionName}" in the skill "${nluProcessResult.skillName}"`
        )

        return resolve({})
      }

      // Map variables from locale config to all the answers
      const { variables } = nluProcessResult.localeSkillConfig
      if (variables) {
        answers = answers.map((answer) => {
          return this.mapAnswerPlaceholders(answer, variables)
        })
      }

      // Prepare data from context (entities and action arguments)
      const data = this.getDataToMap(nluProcessResult.context)

      // Get a random answer
      let randomAnswer = this.getDialogAnswer(answers)
      // Find a fallback answer if necessary
      randomAnswer = this.getFallbackAnswer(randomAnswer, answers, data)

      // Map data from context
      const finalAnswer = this.mapAnswerPlaceholders(randomAnswer, data)

      if (!BRAIN.isMuted) {
        BRAIN.talk(finalAnswer, true)
      }

      // TODO: core rewrite suggestion after dialog skill
      // Send suggestions to the client
      /*if (nextAction?.suggestions) {
        SOCKET_SERVER.socket?.emit('suggest', nextAction.suggestions)
      }*/

      resolve({
        utteranceId,
        lang: BRAIN.lang,
        core: {}
        // action,
        // nextAction
      })
    })
  }

  /**
   * Get a random answer from the list of answers
   */
  private static getDialogAnswer(
    answers: SkillAnswerConfigSchema[]
  ): SkillAnswerConfigSchema {
    return answers[
      Math.floor(Math.random() * answers.length)
    ] as SkillAnswerConfigSchema
  }

  /**
   * Map placeholders in the answer with the given data
   */
  private static mapAnswerPlaceholders(
    answer: SkillAnswerConfigSchema,
    data: Record<string, unknown>
  ): SkillAnswerConfigSchema {
    if (Object.keys(data).length === 0) {
      return answer
    }

    const dataToMap = Object.entries(data).reduce(
      (acc, [key, value]) => {
        acc[`{{ ${key} }}`] = value
        return acc
      },
      {} as Record<string, unknown>
    )

    // In case the answer is a type of { text: '...', speech: '...' }
    if (typeof answer === 'object') {
      const { text, speech } = answer
      const newText =
        text && PLACEHOLDER_REGEX.test(text)
          ? StringHelper.findAndMap(text, dataToMap)
          : text
      const newSpeech = PLACEHOLDER_REGEX.test(speech)
        ? StringHelper.findAndMap(speech, dataToMap)
        : speech

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      return {
        text: newText,
        speech: newSpeech
      }
    }

    if (PLACEHOLDER_REGEX.test(answer)) {
      return StringHelper.findAndMap(answer, dataToMap)
    }

    return answer
  }

  /**
   * Check if the answer contains placeholders
   */
  private static answerHasPlaceholders(
    answer: SkillAnswerConfigSchema
  ): boolean {
    if (typeof answer === 'string') {
      return PLACEHOLDER_REGEX.test(answer)
    }

    if (typeof answer === 'object') {
      return (
        PLACEHOLDER_REGEX.test(answer.text || '') ||
        PLACEHOLDER_REGEX.test(answer.speech || '')
      )
    }

    return false
  }

  /**
   * Get a fallback answer if the current one has placeholders
   * but no data is available
   */
  private static getFallbackAnswer(
    currentAnswer: SkillAnswerConfigSchema,
    allAnswers: SkillAnswerConfigSchema[],
    data: Record<string, unknown>
  ): SkillAnswerConfigSchema {
    // If the answer has placeholders and no data to map, we need to find a fallback answer that does not have placeholders
    if (
      this.answerHasPlaceholders(currentAnswer) &&
      Object.keys(data).length === 0
    ) {
      const fallbackAnswers = allAnswers.filter(
        (ans) => !this.answerHasPlaceholders(ans)
      )

      if (fallbackAnswers.length > 0) {
        return this.getDialogAnswer(fallbackAnswers)
      }
    }

    return currentAnswer
  }

  /**
   * Get data from entities and action arguments to map to the answer
   */
  private static getDataToMap(
    context: NLUProcessResult['context']
  ): Record<string, unknown> {
    const { actionArguments, entities } = context
    const entitiesAsObject = entities.reduce(
      (acc, entity) => {
        // TODO: mapping to resolution.value may not always be correct. E.g. date entity, etc. See if this should be improved according to future needs
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        acc[entity.entity] = entity.resolution.value
        return acc
      },
      {} as Record<string, unknown>
    )
    const actionArgumentsAsObject = (
      actionArguments as Record<string, unknown>[]
    ).reduce((acc, arg) => ({ ...acc, ...arg }), {})

    // Prioritize actionArguments over entities
    return {
      ...entitiesAsObject,
      ...actionArgumentsAsObject
    }
  }
}
