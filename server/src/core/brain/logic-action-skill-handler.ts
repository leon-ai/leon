import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'

import type { NLUProcessResult } from '@/core/nlp/types'
import type {
  BrainProcessResult,
  SkillResult,
  IntentObject
} from '@/core/brain/types'
import { SkillBridges } from '@/core/brain/types'
import {
  TMP_PATH,
  PYTHON_BRIDGE_BIN_PATH,
  NODEJS_BRIDGE_BIN_PATH
} from '@/constants'
import { BRAIN, SOCKET_SERVER, NLU } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { DateHelper } from '@/helpers/date-helper'

export class LogicActionSkillHandler {
  public static async handle(
    nluProcessResult: NLUProcessResult,
    utteranceId: string
  ): Promise<Partial<BrainProcessResult>> {
    return new Promise(async (resolve) => {
      const intentObjectPath = path.join(TMP_PATH, `${utteranceId}.json`)
      const {
        skillConfig: { name: skillFriendlyName }
      } = nluProcessResult

      await this.executeLogicActionSkill(
        nluProcessResult,
        utteranceId,
        intentObjectPath
      )

      BRAIN.skillFriendlyName = skillFriendlyName

      let buffer = ''
      let lastSkillResult: SkillResult | undefined = undefined

      // Read skill output
      BRAIN.skillProcess?.stdout.on('data', (data: Buffer) => {
        SOCKET_SERVER.socket?.emit('is-typing', true)
        buffer += data.toString()

        let newlineIndex
        // Process buffer line by line
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const chunk = buffer.substring(0, newlineIndex)

          buffer = buffer.substring(newlineIndex + 1)

          if (chunk) {
            // Check if this is a tool log first
            if (chunk.includes('[LEON_TOOL_LOG]')) {
              // Extract and log the tool message without treating it as skill response
              const cleanedMessage = chunk.replace('[LEON_TOOL_LOG]', '').trim()
              if (cleanedMessage) {
                LogHelper.title(`${BRAIN.skillFriendlyName} skill (tool log)`)
                LogHelper.info(cleanedMessage)
              }
            } else {
              // Process as normal JSON skill response
              try {
                const skillResult = JSON.parse(chunk) as SkillResult

                // Store the latest result
                lastSkillResult = skillResult
                this.handleLogicActionSkillProcessOutput(skillResult)
              } catch (e) {
                LogHelper.title('Brain')
                LogHelper.error(`Error parsing chunk: ${chunk}. Details: ${e}`)
              }
            }
          }
        }
      })

      // Handle error
      BRAIN.skillProcess?.stderr.on('data', (data: Buffer) => {
        this.handleLogicActionSkillProcessError(data, intentObjectPath)
      })

      // Catch the end of the skill execution
      BRAIN.skillProcess?.stdout.on('end', () => {
        LogHelper.title(`${BRAIN.skillFriendlyName} skill (on end)`)

        // Attempt to process any remaining data in the buffer
        if (buffer.trim()) {
          try {
            const skillResult = JSON.parse(buffer) as SkillResult

            lastSkillResult = skillResult
            this.handleLogicActionSkillProcessOutput(skillResult)
          } catch (e) {
            LogHelper.title(`${BRAIN.skillFriendlyName} skill`)
            LogHelper.error(`Error on the final output: ${String(e)}`)

            BRAIN.speakSkillError()
          }
        }

        this.deleteIntentObjFile(intentObjectPath)

        resolve({
          utteranceId,
          lang: BRAIN.lang,
          ...nluProcessResult,
          core: lastSkillResult?.output.core,
          lastOutputFromSkill: lastSkillResult?.output
        })

        SOCKET_SERVER.socket?.emit('is-typing', false)
      })

      // Reset the child process
      BRAIN.skillProcess = undefined
    })
  }

  /**
   * Handle the skill process output for each complete chunk of data
   */
  private static handleLogicActionSkillProcessOutput(
    skillAnswer: SkillResult
  ): void {
    if (typeof skillAnswer !== 'object' || !skillAnswer.output) {
      LogHelper.error(
        `The "${BRAIN.skillFriendlyName}" skill returned an invalid result.`
      )

      return
    }

    // Always merge simple context data if provided
    if (skillAnswer.output.core?.context_data) {
      NLU.nluProcessResult.context.data = {
        ...NLU.nluProcessResult.context.data,
        ...skillAnswer.output.core.context_data
      }
    }

    LogHelper.title(`${BRAIN.skillFriendlyName} skill (on data)`)
    LogHelper.info(JSON.stringify(skillAnswer))

    /**
     * Handle widget answers
     *
     * Verify the brain is not muted since when we fetch widgets we should
     * not speak the answers
     */
    if (skillAnswer.output.widget && !BRAIN.isMuted) {
      try {
        /**
         * Send widget data with replaceMessageId (to target the same message id for the client).
         * Useful for a progress report, etc.
         */
        const answerData = {
          ...skillAnswer.output.widget,
          replaceMessageId: skillAnswer.output.replaceMessageId || null
        }

        SOCKET_SERVER.socket?.emit('answer', answerData)
      } catch (e) {
        LogHelper.title('Brain')
        LogHelper.error(
          `Failed to send widget. Widget output is not well formatted: ${e}`
        )
      }
    } else {
      /**
       * Handle non-widget answers
       */
      const { answer } = skillAnswer.output
      if (answer && !BRAIN.isMuted) {
        // Check if this is a tool output
        const isToolOutput = skillAnswer.output.core?.isToolOutput === true

        if (isToolOutput) {
          // Handle tool outputs with special formatting
          const toolData = {
            answer,
            isToolOutput: true,
            toolkitName: skillAnswer.output.core?.toolkitName,
            toolName: skillAnswer.output.core?.toolName,
            toolGroupId: skillAnswer.output.core?.toolGroupId,
            key: skillAnswer.output.codes,
            replaceMessageId: skillAnswer.output.replaceMessageId || null
          }

          SOCKET_SERVER.socket?.emit('answer', toolData)
        } else {
          // Handle regular skill answers
          if (skillAnswer.output.replaceMessageId) {
            const answerData = {
              answer,
              replaceMessageId: skillAnswer.output.replaceMessageId
            }

            SOCKET_SERVER.socket?.emit('answer', answerData)
          } else {
            // For regular answers without replacement, use BRAIN.talk which handles the answer event
            BRAIN.talk(answer, true)
          }
        }
      }
    }
  }

  /**
   * Handle the skill process error
   */
  private static handleLogicActionSkillProcessError(
    data: Buffer,
    intentObjectPath: string
  ): Error {
    BRAIN.speakSkillError()

    this.deleteIntentObjFile(intentObjectPath)

    LogHelper.title(`${BRAIN.skillFriendlyName} skill`)
    LogHelper.error(data.toString())

    return new Error(data.toString())
  }

  /**
   * Execute an action logic skill in a standalone way (CLI):
   *
   * 1. Need to be at the root of the project
   * 2. Edit: server/src/intent-object.sample.json
   * 3. Run: npm run python-bridge
   */
  private static async executeLogicActionSkill(
    nluProcessResult: NLUProcessResult,
    utteranceId: string,
    intentObjectPath: string
  ): Promise<void> {
    // Ensure the process is empty (to be able to execute other processes outside of Brain)
    if (!BRAIN.skillProcess) {
      const intentObject = this.createIntentObject(
        nluProcessResult,
        utteranceId
      )

      try {
        await fs.promises.writeFile(
          intentObjectPath,
          JSON.stringify(intentObject)
        )

        const { bridge: skillBridge } = nluProcessResult.skillConfig

        if (skillBridge === SkillBridges.Python) {
          BRAIN.skillProcess = spawn(
            `${PYTHON_BRIDGE_BIN_PATH} "${intentObjectPath}"`,
            { shell: true }
          )
        } else if (skillBridge === SkillBridges.NodeJS) {
          BRAIN.skillProcess = spawn(
            `${NODEJS_BRIDGE_BIN_PATH} "${intentObjectPath}"`,
            { shell: true }
          )
        } else {
          LogHelper.error(`The skill bridge is not supported: ${skillBridge}`)
        }
      } catch (e) {
        LogHelper.error(`Failed to save intent object: ${e}`)
      }
    }
  }

  /**
   * Create the intent object that will be passed to the skill
   */
  private static createIntentObject(
    nluProcessResult: NLUProcessResult,
    utteranceId: string
  ): IntentObject {
    const date = DateHelper.getDateTime()
    const dateObject = new Date(date)

    return {
      id: utteranceId,
      lang: BRAIN.lang,
      context_name: nluProcessResult.contextName,
      skill_name: nluProcessResult.skillName,
      action_name: nluProcessResult.actionName,
      skill_config: {
        name: nluProcessResult.skillConfig.name,
        bridge: nluProcessResult.skillConfig.bridge as SkillBridges,
        version: nluProcessResult.skillConfig.version,
        flow: nluProcessResult.skillConfig.flow as string[]
      },
      skill_config_path: nluProcessResult.skillConfigPath,
      utterance: nluProcessResult.new.utterance,
      action_arguments: nluProcessResult.new.actionArguments,
      entities: nluProcessResult.new.entities,
      sentiment: nluProcessResult.new.sentiment,
      context: {
        utterances: nluProcessResult.context.utterances,
        action_arguments: nluProcessResult.context.actionArguments,
        entities: nluProcessResult.context.entities,
        sentiments: nluProcessResult.context.sentiments,
        data: nluProcessResult.context.data
      },
      extra_context: {
        lang: BRAIN.lang,
        date: date.slice(0, 10),
        time: date.slice(11, 19),
        timestamp: dateObject.getTime(),
        date_time: date,
        week_day: dateObject.toLocaleString('default', { weekday: 'long' })
      }
    }
  }

  /**
   * Delete intent object file
   */
  private static deleteIntentObjFile(intentObjectPath: string): void {
    try {
      if (fs.existsSync(intentObjectPath)) {
        fs.unlinkSync(intentObjectPath)
      }
    } catch (e) {
      LogHelper.error(`Failed to delete intent object file: ${e}`)
    }
  }
}
