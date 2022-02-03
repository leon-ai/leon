import fs from 'fs'
import { spawn } from 'child_process'

import { langs } from '@@/core/langs.json'
import log from '@/helpers/log'
import string from '@/helpers/string'
import Synchronizer from '@/core/synchronizer'

class Brain {
  constructor (lang) {
    this.lang = lang
    this.broca = JSON.parse(fs.readFileSync(`${__dirname}/../data/en.json`, 'utf8'))
    this.process = { }
    this.interOutput = { }
    this.finalOutput = { }
    this._socket = { }
    this._tts = { }

    // Read into the language file
    const file = `${__dirname}/../data/${this.lang}.json`
    if (fs.existsSync(file)) {
      this.broca = JSON.parse(fs.readFileSync(file, 'utf8'))
    }

    log.title('Brain')
    log.success('New instance')
  }

  get socket () {
    return this._socket
  }

  set socket (newSocket) {
    this._socket = newSocket
  }

  get tts () {
    return this._tts
  }

  set tts (newTts) {
    this._tts = newTts
  }

  /**
   * Delete query object file
   */
  static deleteQueryObjFile (queryObjectPath) {
    try {
      fs.unlinkSync(queryObjectPath)
    } catch (e) {
      log.error(`Failed to delete query object file: ${e}`)
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
   * Execute Python modules
   */
  execute (obj, opts) {
    const executionTimeStart = Date.now()
    opts = opts || {
      mute: false // Close Leon mouth e.g. over HTTP
    }

    return new Promise((resolve, reject) => {
      const queryId = `${Date.now()}-${string.random(4)}`
      const queryObjectPath = `${__dirname}/../tmp/${queryId}.json`
      const speeches = []

      // Ask to repeat if Leon is not sure about the request
      if (obj.classification.confidence < langs[process.env.LEON_LANG].min_confidence) {
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
           * Execute a module in a standalone way (CLI):
           *
           * 1. Need to be at the root of the project
           * 2. Edit: server/src/query-object.sample.json
           * 3. Run: PIPENV_PIPFILE=bridges/python/Pipfile pipenv run
           *    python bridges/python/main.py server/src/query-object.sample.json
           */
          const queryObj = {
            id: queryId,
            lang: langs[process.env.LEON_LANG].short,
            package: obj.classification.package,
            module: obj.classification.module,
            action: obj.classification.action,
            query: obj.query,
            entities: obj.entities
          }

          try {
            fs.writeFileSync(queryObjectPath, JSON.stringify(queryObj))
            this.process = spawn(`pipenv run python bridges/python/main.py ${queryObjectPath}`, { shell: true })
          } catch (e) {
            log.error(`Failed to save query object: ${e}`)
          }
        }

        const packageName = string.ucfirst(obj.classification.package)
        const moduleName = string.ucfirst(obj.classification.module)
        let output = ''

        // Read output
        this.process.stdout.on('data', (data) => {
          const obj = JSON.parse(data.toString())

          if (typeof obj === 'object') {
            if (obj.output.type === 'inter') {
              log.title(`${packageName} package`)
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
            const executionTimeEnd = Date.now()
            const executionTime = executionTimeEnd - executionTimeStart

            /* istanbul ignore next */
            reject({
              type: 'warning',
              obj: new Error(`The ${moduleName} module of the ${packageName} package is not well configured. Check the configuration file.`),
              speeches,
              executionTime
            })
          }
        })

        // Handle error
        this.process.stderr.on('data', (data) => {
          console.debug('DATA', data.toString())
          const speech = `${this.wernicke('random_package_module_errors', '',
            { '%module_name%': moduleName, '%package_name%': packageName })}!`
          if (!opts.mute) {
            this.talk(speech)
            this._socket.emit('is-typing', false)
          }
          speeches.push(speech)

          Brain.deleteQueryObjFile(queryObjectPath)

          log.title(packageName)

          const executionTimeEnd = Date.now()
          const executionTime = executionTimeEnd - executionTimeStart
          reject({
            type: 'error',
            obj: new Error(data),
            speeches,
            executionTime
          })
        })

        // Catch the end of the module execution
        this.process.stdout.on('end', () => {
          log.title(`${packageName} package`)
          log.info(output)

          this.finalOutput = output

          // Check if there is an output (no module error)
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

          Brain.deleteQueryObjFile(queryObjectPath)

          if (!opts.mute) {
            this._socket.emit('is-typing', false)
          }

          const executionTimeEnd = Date.now()
          const executionTime = executionTimeEnd - executionTimeStart

          resolve({
            queryId,
            lang: langs[process.env.LEON_LANG].short,
            ...obj,
            speeches,
            executionTime // In ms, module execution time only
          })
        })

        // Reset the child process
        this.process = { }
      }
    })
  }
}

export default Brain
