import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

import { langs } from '@@/core/langs.json'
import log from '@/helpers/log'
import string from '@/helpers/string'
import Synchronizer from '@/core/synchronizer'
import lang from '@/helpers/lang'
import domain from '@/helpers/domain'

class Brain {
  constructor () {
    this._lang = 'en'
    this.broca = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'core/data', this._lang, 'answers.json'), 'utf8'))
    this.process = { }
    this.interOutput = { }
    this.finalOutput = { }
    this._socket = { }
    this._stt = { }
    this._tts = { }

    log.title('Brain')
    log.success('New instance')
  }

  get socket () {
    return this._socket
  }

  set socket (newSocket) {
    this._socket = newSocket
  }

  get stt () {
    return this._stt
  }

  set stt (newStt) {
    this._stt = newStt
  }

  get tts () {
    return this._tts
  }

  set tts (newTts) {
    this._tts = newTts
  }

  get lang () {
    return this._lang
  }

  set lang (newLang) {
    this._lang = newLang
    // Update broca
    this.broca = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'core/data', this._lang, 'answers.json'), 'utf8'))

    if (process.env.LEON_TTS === 'true') {
      this._tts.init(this._lang, () => {
        log.title('Brain')
        log.info('Language has changed')
      })
    }
  }

  /**
   * Delete intent object file
   */
  static deleteIntentObjFile (intentObjectPath) {
    try {
      if (fs.existsSync(intentObjectPath)) {
        fs.unlinkSync(intentObjectPath)
      }
    } catch (e) {
      log.error(`Failed to delete intent object file: ${e}`)
    }
  }

  /**
   * Make Leon talk
   */
  talk (rawSpeech, end = false) {
    log.title('Leon')
    log.info('Talking...')

    if (rawSpeech !== '') {
      if (process.env.LEON_TTS === 'true') {
        // Stripe HTML to a whitespace. Whitespace to let the TTS respects punctuation
        const speech = rawSpeech.replace(/<(?:.|\n)*?>/gm, ' ')

        this._tts.add(speech, end)
      }

      this._socket.emit('answer', rawSpeech)
    }
  }

  /**
   * Pickup speech info we need to return
   */
  wernicke (type, key, obj) {
    let answer = ''

    // Choose a random answer or a specific one
    const property = this.broca.answers[type]
    if (property.constructor === [].constructor) {
      answer = property[Math.floor(Math.random() * property.length)]
    } else {
      answer = property
    }

    // Select a specific key
    if (key !== '' && typeof key !== 'undefined') {
      answer = answer[key]
    }

    // Parse sentence's value(s) and replace with the given object
    if (typeof obj !== 'undefined' && Object.keys(obj).length > 0) {
      answer = string.pnr(answer, obj)
    }

    return answer
  }

  /**
   * Execute Python skills
   */
  execute (obj, opts) {
    const executionTimeStart = Date.now()
    opts = opts || {
      mute: false // Close Leon mouth e.g. over HTTP
    }

    return new Promise((resolve, reject) => {
      const utteranceId = `${Date.now()}-${string.random(4)}`
      const intentObjectPath = path.join(__dirname, `../tmp/${utteranceId}.json`)
      const speeches = []

      // Ask to repeat if Leon is not sure about the request
      if (obj.classification.confidence < langs[lang.getLongCode(this._lang)].min_confidence) {
        if (!opts.mute) {
          const speech = `${this.wernicke('random_not_sure')}.`

          speeches.push(speech)
          this.talk(speech, true)
          this._socket.emit('is-typing', false)
        }

        const executionTimeEnd = Date.now()
        const executionTime = executionTimeEnd - executionTimeStart

        resolve({
          speeches,
          executionTime
        })
      } else {
        // Ensure the process is empty (to be able to execute other processes outside of Brain)
        if (Object.keys(this.process).length === 0) {
          /**
           * Execute a skill in a standalone way (CLI):
           *
           * 1. Need to be at the root of the project
           * 2. Edit: server/src/intent-object.sample.json
           * 3. Run: PIPENV_PIPFILE=bridges/python/Pipfile pipenv run
           *    python bridges/python/main.py server/src/intent-object.sample.json
           */
          const intentObj = {
            id: utteranceId,
            lang: this._lang,
            domain: obj.classification.domain,
            skill: obj.classification.skill,
            action: obj.classification.action,
            utterance: obj.utterance,
            entities: obj.entities
          }

          try {
            fs.writeFileSync(intentObjectPath, JSON.stringify(intentObj))
            this.process = spawn(`pipenv run python bridges/python/main.py ${intentObjectPath}`, { shell: true })
          } catch (e) {
            log.error(`Failed to save intent object: ${e}`)
          }
        }

        const domainName = obj.classification.domain
        const skillName = obj.classification.skill
        const domainFriendlyName = domain.getDomainName(domainName)
        const skillFriendlyName = domain.getSkillName(domainName, skillName)
        let output = ''

        // Read output
        this.process.stdout.on('data', (data) => {
          const executionTimeEnd = Date.now()
          const executionTime = executionTimeEnd - executionTimeStart

          try {
            const obj = JSON.parse(data.toString())

            if (typeof obj === 'object') {
              if (obj.output.type === 'inter') {
                log.title(`${skillFriendlyName} skill`)
                log.info(data.toString())

                this.interOutput = obj.output

                const speech = obj.output.speech.toString()
                if (!opts.mute) {
                  this.talk(speech)
                }
                speeches.push(speech)
              } else {
                output += data
              }
            } else {
              /* istanbul ignore next */
              reject({
                type: 'warning',
                obj: new Error(`The "${skillFriendlyName}" skill from the "${domainFriendlyName}" domain is not well configured. Check the configuration file.`),
                speeches,
                executionTime
              })
            }
          } catch (e) {
            /* istanbul ignore next */
            reject({
              type: 'error',
              obj: new Error(`The "${skillFriendlyName}" skill from the "${domainFriendlyName}" domain isn't returning JSON format.`),
              speeches,
              executionTime
            })
          }
        })

        // Handle error
        this.process.stderr.on('data', (data) => {
          const speech = `${this.wernicke('random_skill_errors', '',
            { '%skill_name%': skillFriendlyName, '%domain_name%': domainFriendlyName })}!`
          if (!opts.mute) {
            this.talk(speech)
            this._socket.emit('is-typing', false)
          }
          speeches.push(speech)

          Brain.deleteIntentObjFile(intentObjectPath)

          log.title(`${skillFriendlyName} skill`)
          log.error(data.toString())

          const executionTimeEnd = Date.now()
          const executionTime = executionTimeEnd - executionTimeStart
          reject({
            type: 'error',
            obj: new Error(data),
            speeches,
            executionTime
          })
        })

        // Catch the end of the skill execution
        this.process.stdout.on('end', () => {
          log.title(`${skillFriendlyName} skill`)
          log.info(output)

          this.finalOutput = output

          // Check if there is an output (no skill error)
          if (this.finalOutput !== '') {
            this.finalOutput = JSON.parse(this.finalOutput).output

            const speech = this.finalOutput.speech.toString()
            if (!opts.mute) {
              this.talk(speech, true)
            }
            speeches.push(speech)

            /* istanbul ignore next */
            // Synchronize the downloaded content if enabled
            if (this.finalOutput.type === 'end' && this.finalOutput.options.synchronization && this.finalOutput.options.synchronization.enabled
              && this.finalOutput.options.synchronization.enabled === true) {
              const sync = new Synchronizer(
                this,
                obj.classification,
                this.finalOutput.options.synchronization
              )

              // When the synchronization is finished
              sync.synchronize((speech) => {
                if (!opts.mute) {
                  this.talk(speech)
                }
                speeches.push(speech)
              })
            }
          }

          Brain.deleteIntentObjFile(intentObjectPath)

          if (!opts.mute) {
            this._socket.emit('is-typing', false)
          }

          const executionTimeEnd = Date.now()
          const executionTime = executionTimeEnd - executionTimeStart

          resolve({
            utteranceId,
            lang: this._lang,
            ...obj,
            speeches,
            executionTime // In ms, skill execution time only
          })
        })

        // Reset the child process
        this.process = { }
      }
    })
  }
}

export default Brain
