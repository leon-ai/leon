import fs from 'node:fs'
import path from 'node:path'
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'

import type { ShortLanguageCode } from '@/types'
import type { GlobalAnswersSchema } from '@/schemas/global-data-schemas'
import type {
  CustomEnumEntity,
  NERCustomEntity,
  NLUResult
} from '@/core/nlp/types'
import type { SkillConfigSchema, SkillSchema } from '@/schemas/skill-schemas'
import type {
  BrainProcessResult,
  IntentObject,
  SkillResult
} from '@/core/brain/types'
import {
  SkillActionTypes,
  SkillBridges,
  SkillOutputTypes
} from '@/core/brain/types'
import { langs } from '@@/core/langs.json'
import {
  HAS_TTS,
  PYTHON_BRIDGE_BIN_PATH,
  NODEJS_BRIDGE_BIN_PATH,
  TMP_PATH
} from '@/constants'
import { SOCKET_SERVER, TTS } from '@/core'
import { LangHelper } from '@/helpers/lang-helper'
import { LogHelper } from '@/helpers/log-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { StringHelper } from '@/helpers/string-helper'
import Synchronizer from '@/core/synchronizer'

export default class Brain {
  private static instance: Brain
  private _lang: ShortLanguageCode = 'en'
  private broca: GlobalAnswersSchema = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'core', 'data', this._lang, 'answers.json'),
      'utf8'
    )
  )
  private skillProcess: ChildProcessWithoutNullStreams | undefined = undefined
  private domainFriendlyName = ''
  private skillFriendlyName = ''
  private skillOutput = ''
  private speeches: string[] = []
  public isMuted = false // Close Leon mouth if true; e.g. over HTTP

  constructor() {
    if (!Brain.instance) {
      LogHelper.title('Brain')
      LogHelper.success('New instance')

      Brain.instance = this
    }
  }

  public get lang(): ShortLanguageCode {
    return this._lang
  }

  public set lang(newLang: ShortLanguageCode) {
    this._lang = newLang
    // Update broca
    this.broca = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'core', 'data', this._lang, 'answers.json'),
        'utf8'
      )
    )

    if (HAS_TTS) {
      this.updateTTSLang(this._lang)
    }
  }

  private async updateTTSLang(newLang: ShortLanguageCode): Promise<void> {
    await TTS.init(newLang)

    LogHelper.title('Brain')
    LogHelper.info('Language has changed')
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

  /**
   * Make Leon talk
   */
  public talk(rawSpeech: string, end = false): void {
    LogHelper.title('Brain')
    LogHelper.info('Talking...')

    if (rawSpeech !== '') {
      if (HAS_TTS) {
        // Stripe HTML to a whitespace. Whitespace to let the TTS respects punctuation
        const speech = rawSpeech.replace(/<(?:.|\n)*?>/gm, ' ')

        TTS.add(speech, end)
      }

      SOCKET_SERVER.socket?.emit('answer', rawSpeech)
    }
  }

  /**
   * Pickup speech info we need to return
   */
  public wernicke(
    type: string,
    key?: string,
    obj?: Record<string, unknown>
  ): string {
    let answerObject: Record<string, string> = {}
    let answer = ''

    // Choose a random answer or a specific one
    let property = this.broca.answers[type]
    if (property?.constructor === [].constructor) {
      property = property as string[]
      answer = property[Math.floor(Math.random() * property.length)] as string
    } else {
      answerObject = property as Record<string, string>
    }

    // Select a specific key
    if (key !== '' && typeof key !== 'undefined') {
      answer = answerObject[key] as string
    }

    // Parse sentence's value(s) and replace with the given object
    if (typeof obj !== 'undefined' && Object.keys(obj).length > 0) {
      answer = StringHelper.findAndMap(answer, obj)
    }

    return answer
  }

  private shouldAskToRepeat(nluResult: NLUResult): boolean {
    return (
      nluResult.classification.confidence <
      langs[LangHelper.getLongCode(this._lang)].min_confidence
    )
  }

  private handleAskToRepeat(nluResult: NLUResult): void {
    if (!this.isMuted) {
      const speech = `${this.wernicke('random_not_sure')}.`

      this.talk(speech, true)
      SOCKET_SERVER.socket?.emit('ask-to-repeat', nluResult)
    }
  }

  /**
   * Create the intent object that will be passed to the skill
   */
  private createIntentObject(
    nluResult: NLUResult,
    utteranceID: string,
    slots: IntentObject['slots']
  ): IntentObject {
    return {
      id: utteranceID,
      lang: this._lang,
      domain: nluResult.classification.domain,
      skill: nluResult.classification.skill,
      action: nluResult.classification.action,
      utterance: nluResult.utterance,
      current_entities: nluResult.currentEntities,
      entities: nluResult.entities,
      current_resolvers: nluResult.currentResolvers,
      resolvers: nluResult.resolvers,
      slots
    }
  }

  /**
   * Handle the skill process output
   */
  private handleLogicActionSkillProcessOutput(
    data: Buffer
  ): Promise<Error | null> | void {
    try {
      const obj = JSON.parse(data.toString())

      if (typeof obj === 'object') {
        if (obj.output.type === SkillOutputTypes.Intermediate) {
          LogHelper.title(`${this.skillFriendlyName} skill`)
          LogHelper.info(data.toString())

          const speech = obj.output.speech.toString()
          if (!this.isMuted) {
            this.talk(speech)
          }
          this.speeches.push(speech)
        } else {
          this.skillOutput = data.toString()
        }

        return Promise.resolve(null)
      } else {
        return Promise.reject(
          new Error(
            `The "${this.skillFriendlyName}" skill from the "${this.domainFriendlyName}" domain is not well configured. Check the configuration file.`
          )
        )
      }
    } catch (e) {
      LogHelper.title('Brain')
      LogHelper.debug(`process.stdout: ${String(data)}`)
    }
  }

  /**
   * Speak about an error happened regarding a specific skill
   */
  private speakSkillError(): void {
    const speech = `${this.wernicke('random_skill_errors', '', {
      '%skill_name%': this.skillFriendlyName,
      '%domain_name%': this.domainFriendlyName
    })}!`
    if (!this.isMuted) {
      this.talk(speech)
      SOCKET_SERVER.socket?.emit('is-typing', false)
    }
    this.speeches.push(speech)
  }

  /**
   * Handle the skill process error
   */
  private handleLogicActionSkillProcessError(
    data: Buffer,
    intentObjectPath: string
  ): Error {
    this.speakSkillError()

    Brain.deleteIntentObjFile(intentObjectPath)

    LogHelper.title(`${this.skillFriendlyName} skill`)
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
  private async executeLogicActionSkill(
    nluResult: NLUResult,
    skillBridge: SkillSchema['bridge'],
    utteranceID: string,
    intentObjectPath: string
  ): Promise<void> {
    // Ensure the process is empty (to be able to execute other processes outside of Brain)
    if (!this.skillProcess) {
      const slots: IntentObject['slots'] = {}

      if (nluResult.slots) {
        Object.keys(nluResult.slots)?.forEach((slotName) => {
          slots[slotName] = nluResult.slots[slotName]?.value
        })
      }

      const intentObject = this.createIntentObject(
        nluResult,
        utteranceID,
        slots
      )

      try {
        await fs.promises.writeFile(
          intentObjectPath,
          JSON.stringify(intentObject)
        )

        if (skillBridge === SkillBridges.Python) {
          this.skillProcess = spawn(
            `${PYTHON_BRIDGE_BIN_PATH} "${intentObjectPath}"`,
            { shell: true }
          )
        } else if (skillBridge === SkillBridges.NodeJS) {
          this.skillProcess = spawn(
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
   * Execute Python skills
   */
  public execute(nluResult: NLUResult): Promise<Partial<BrainProcessResult>> {
    const executionTimeStart = Date.now()

    return new Promise(async (resolve) => {
      const utteranceID = `${Date.now()}-${StringHelper.random(4)}`
      const intentObjectPath = path.join(TMP_PATH, `${utteranceID}.json`)
      const speeches: string[] = []

      // Reset skill output
      this.skillOutput = ''

      // Ask to repeat if Leon is not sure about the request
      if (this.shouldAskToRepeat(nluResult)) {
        this.handleAskToRepeat(nluResult)

        const executionTimeEnd = Date.now()
        const executionTime = executionTimeEnd - executionTimeStart

        resolve({
          speeches,
          executionTime
        })
      } else {
        const {
          skillConfigPath,
          classification: { action: actionName }
        } = nluResult
        const { actions } = await SkillDomainHelper.getSkillConfig(
          skillConfigPath,
          this._lang
        )
        const action = actions[
          actionName
        ] as SkillConfigSchema['actions'][string]
        const { type: actionType } = action
        const nextAction = action.next_action
          ? actions[action.next_action]
          : null

        if (actionType === SkillActionTypes.Logic) {
          /**
           * "Logic" action skill execution
           */

          const domainName = nluResult.classification.domain
          const skillName = nluResult.classification.skill
          const { name: domainFriendlyName } =
            await SkillDomainHelper.getSkillDomainInfo(domainName)
          const { name: skillFriendlyName, bridge: skillBridge } =
            await SkillDomainHelper.getSkillInfo(domainName, skillName)

          await this.executeLogicActionSkill(
            nluResult,
            skillBridge,
            utteranceID,
            intentObjectPath
          )

          this.domainFriendlyName = domainFriendlyName
          this.skillFriendlyName = skillFriendlyName

          // Read skill output
          this.skillProcess?.stdout.on('data', (data: Buffer) => {
            this.handleLogicActionSkillProcessOutput(data)
          })

          // Handle error
          this.skillProcess?.stderr.on('data', (data: Buffer) => {
            this.handleLogicActionSkillProcessError(data, intentObjectPath)
          })

          // Catch the end of the skill execution
          this.skillProcess?.stdout.on('end', () => {
            LogHelper.title(`${this.skillFriendlyName} skill`)
            LogHelper.info(this.skillOutput)

            let skillResult: SkillResult | undefined = undefined

            // Check if there is an output (no skill error)
            if (this.skillOutput !== '') {
              try {
                skillResult = JSON.parse(this.skillOutput)

                if (skillResult?.output.speech) {
                  skillResult.output.speech =
                    skillResult.output.speech.toString()
                  if (!this.isMuted) {
                    this.talk(skillResult.output.speech, true)
                  }
                  speeches.push(skillResult.output.speech)

                  // Synchronize the downloaded content if enabled
                  if (
                    skillResult.output.type === SkillOutputTypes.End &&
                    skillResult.output.options['synchronization'] &&
                    skillResult.output.options['synchronization'].enabled &&
                    skillResult.output.options['synchronization'].enabled ===
                      true
                  ) {
                    const sync = new Synchronizer(
                      this,
                      nluResult.classification,
                      skillResult.output.options['synchronization']
                    )

                    // When the synchronization is finished
                    sync.synchronize((speech: string) => {
                      if (!this.isMuted) {
                        this.talk(speech)
                      }
                      speeches.push(speech)
                    })
                  }
                }
              } catch (e) {
                LogHelper.title(`${this.skillFriendlyName} skill`)
                LogHelper.error(
                  `There is an error on the final output: ${String(e)}`
                )

                this.speakSkillError()
              }
            }

            Brain.deleteIntentObjFile(intentObjectPath)

            if (!this.isMuted) {
              SOCKET_SERVER.socket?.emit('is-typing', false)
            }

            const executionTimeEnd = Date.now()
            const executionTime = executionTimeEnd - executionTimeStart

            // Send suggestions to the client
            if (
              nextAction?.suggestions &&
              skillResult?.output.core?.showNextActionSuggestions
            ) {
              SOCKET_SERVER.socket?.emit('suggest', nextAction.suggestions)
            }
            if (
              action?.suggestions &&
              skillResult?.output.core?.showSuggestions
            ) {
              SOCKET_SERVER.socket?.emit('suggest', action.suggestions)
            }

            resolve({
              utteranceID,
              lang: this._lang,
              ...nluResult,
              speeches,
              core: skillResult?.output.core,
              action,
              nextAction,
              executionTime // In ms, skill execution time only
            })
          })

          // Reset the child process
          this.skillProcess = undefined
        } else {
          /**
           * "Dialog" action skill execution
           */

          const configFilePath = path.join(
            process.cwd(),
            'skills',
            nluResult.classification.domain,
            nluResult.classification.skill,
            'config',
            this._lang + '.json'
          )
          const { actions, entities: skillConfigEntities } =
            await SkillDomainHelper.getSkillConfig(configFilePath, this._lang)
          const utteranceHasEntities = nluResult.entities.length > 0
          const { answers: rawAnswers } = nluResult
          let answers = rawAnswers
          let answer: string | undefined = ''

          if (!utteranceHasEntities) {
            answers = answers.filter(
              ({ answer }) => answer.indexOf('{{') === -1
            )
          } else {
            answers = answers.filter(
              ({ answer }) => answer.indexOf('{{') !== -1
            )
          }

          // When answers are simple without required entity
          if (answers.length === 0) {
            answer =
              rawAnswers[Math.floor(Math.random() * rawAnswers.length)]?.answer

            // In case the expected answer requires a known entity
            if (answer?.indexOf('{{') !== -1) {
              // TODO
              const unknownAnswers =
                actions[nluResult.classification.action]?.unknown_answers

              if (unknownAnswers) {
                answer =
                  unknownAnswers[
                    Math.floor(Math.random() * unknownAnswers.length)
                  ]
              }
            }
          } else {
            answer = answers[Math.floor(Math.random() * answers.length)]?.answer

            /**
             * In case the utterance contains entities, and the picked up answer too,
             * then map them (utterance <-> answer)
             */
            if (utteranceHasEntities && answer?.indexOf('{{') !== -1) {
              nluResult.currentEntities.forEach((entityObj) => {
                answer = StringHelper.findAndMap(answer as string, {
                  [`{{ ${entityObj.entity} }}`]: (entityObj as NERCustomEntity)
                    .resolution.value
                })

                /**
                 * Find matches and map deeper data from the NLU file (global entities)
                 * TODO: handle more entity types, not only enums for global entities?
                 */
                const matches = answer.match(/{{.+?}}/g)

                matches?.forEach((match) => {
                  let newStr = match.substring(3)

                  newStr = newStr.substring(0, newStr.indexOf('}}') - 1)

                  const [entity, dataKey] = newStr.split('.')

                  if (entity && dataKey && entity === entityObj.entity) {
                    const { option } = entityObj as CustomEnumEntity

                    const entityOption =
                      skillConfigEntities[entity]?.options[option]
                    const entityOptionData = entityOption?.data
                    let valuesArr: string[] = []

                    if (entityOptionData) {
                      // e.g. entities.color.options.red.data.hexa[]
                      valuesArr = entityOptionData[dataKey] as string[]
                    }

                    if (valuesArr.length > 0) {
                      answer = StringHelper.findAndMap(answer as string, {
                        [match]:
                          valuesArr[
                            Math.floor(Math.random() * valuesArr.length)
                          ]
                      })
                    }
                  }
                })
              })
            }
          }

          const executionTimeEnd = Date.now()
          const executionTime = executionTimeEnd - executionTimeStart

          if (!this.isMuted) {
            this.talk(answer as string, true)
            SOCKET_SERVER.socket?.emit('is-typing', false)
          }

          // Send suggestions to the client
          if (nextAction?.suggestions) {
            SOCKET_SERVER.socket?.emit('suggest', nextAction.suggestions)
          }

          resolve({
            utteranceID,
            lang: this._lang,
            ...nluResult,
            speeches: [answer as string],
            core: {},
            action,
            nextAction,
            executionTime // In ms, skill execution time only
          })
        }
      }
    })
  }
}
