import fs from 'node:fs'
import os from 'node:os'

import dotenv from 'dotenv'
import { command } from 'execa'
import semver from 'semver'

import { version } from '@@/package.json'
import { LogHelper } from '@/helpers/log-helper'
import { PYTHON_BRIDGE_BIN_PATH } from '@/constants'

dotenv.config()

/**
 * Checking script
 * Help to figure out what is installed or not
 */
export default () =>
  new Promise(async (resolve, reject) => {
    try {
      const nodeMinRequiredVersion = '10'
      const npmMinRequiredVersion = '5'
      const flitePath = 'bin/flite/flite'
      const coquiLanguageModelPath = 'bin/coqui/huge-vocabulary.scorer'
      const amazonPath = 'core/config/voice/amazon.json'
      const googleCloudPath = 'core/config/voice/google-cloud.json'
      const watsonSttPath = 'core/config/voice/watson-stt.json'
      const watsonTtsPath = 'core/config/voice/watson-tts.json'
      const globalResolversNlpModelPath =
        'core/data/models/leon-global-resolvers-model.nlp'
      const skillsResolversNlpModelPath =
        'core/data/models/leon-skills-resolvers-model.nlp'
      const mainNlpModelPath = 'core/data/models/leon-main-model.nlp'
      const report = {
        can_run: { title: 'Run', type: 'error', v: true },
        can_run_skill: { title: 'Run skills', type: 'error', v: true },
        can_text: { title: 'Reply you by texting', type: 'error', v: true },
        can_amazon_polly_tts: {
          title: 'Amazon Polly text-to-speech',
          type: 'warning',
          v: true
        },
        can_google_cloud_tts: {
          title: 'Google Cloud text-to-speech',
          type: 'warning',
          v: true
        },
        can_watson_tts: {
          title: 'Watson text-to-speech',
          type: 'warning',
          v: true
        },
        can_offline_tts: {
          title: 'Offline text-to-speech',
          type: 'warning',
          v: true
        },
        can_google_cloud_stt: {
          title: 'Google Cloud speech-to-text',
          type: 'warning',
          v: true
        },
        can_watson_stt: {
          title: 'Watson speech-to-text',
          type: 'warning',
          v: true
        },
        can_offline_stt: {
          title: 'Offline speech-to-text',
          type: 'warning',
          v: true
        }
      }

      LogHelper.title('Checking')

      /**
       * Leon version checking
       */

      LogHelper.info('Leon version')
      LogHelper.success(`${version}\n`)

      /**
       * Environment checking
       */

      LogHelper.info('OS')

      const osInfo = {
        type: os.type(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        release: os.release()
      }
      LogHelper.success(`${JSON.stringify(osInfo)}\n`)
      ;(
        await Promise.all([
          command('node --version', { shell: true }),
          command('npm --version', { shell: true })
        ])
      ).forEach((p) => {
        LogHelper.info(p.command)

        if (
          p.command.indexOf('node --version') !== -1 &&
          !semver.satisfies(
            semver.clean(p.stdout),
            `>=${nodeMinRequiredVersion}`
          )
        ) {
          Object.keys(report).forEach((item) => {
            if (report[item].type === 'error') report[item].v = false
          })
          LogHelper.error(
            `${p.stdout}\nThe Node.js version must be >=${nodeMinRequiredVersion}. Please install it: https://nodejs.org (or use nvm)\n`
          )
        } else if (
          p.command.indexOf('npm --version') !== -1 &&
          !semver.satisfies(
            semver.clean(p.stdout),
            `>=${npmMinRequiredVersion}`
          )
        ) {
          Object.keys(report).forEach((item) => {
            if (report[item].type === 'error') report[item].v = false
          })
          LogHelper.error(
            `${p.stdout}\nThe npm version must be >=${npmMinRequiredVersion}. Please install it: https://www.npmjs.com/get-npm (or use nvm)\n`
          )
        } else {
          LogHelper.success(`${p.stdout}\n`)
        }
      })

      /**
       * Skill execution checking
       */

      try {
        LogHelper.time('Skill execution time')
        const p = await command(
          `${PYTHON_BRIDGE_BIN_PATH} scripts/assets/intent-object.json`,
          { shell: true }
        )
        LogHelper.timeEnd('Skill execution time')
        LogHelper.info(p.command)
        LogHelper.success(`${p.stdout}\n`)
      } catch (e) {
        LogHelper.info(e.command)
        report.can_run_skill.v = false
        LogHelper.error(`${e}\n`)
      }

      /**
       * Global resolvers NLP model checking
       */

      LogHelper.info('Global resolvers NLP model state')

      if (
        !fs.existsSync(globalResolversNlpModelPath) ||
        !Object.keys(fs.readFileSync(globalResolversNlpModelPath)).length
      ) {
        report.can_text.v = false
        Object.keys(report).forEach((item) => {
          if (item.indexOf('stt') !== -1 || item.indexOf('tts') !== -1)
            report[item].v = false
        })
        LogHelper.error(
          'Global resolvers NLP model not found or broken. Try to generate a new one: "npm run train"\n'
        )
      } else {
        LogHelper.success('Found and valid\n')
      }

      /**
       * Skills resolvers NLP model checking
       */

      LogHelper.info('Skills resolvers NLP model state')

      if (
        !fs.existsSync(skillsResolversNlpModelPath) ||
        !Object.keys(fs.readFileSync(skillsResolversNlpModelPath)).length
      ) {
        report.can_text.v = false
        Object.keys(report).forEach((item) => {
          if (item.indexOf('stt') !== -1 || item.indexOf('tts') !== -1)
            report[item].v = false
        })
        LogHelper.error(
          'Skills resolvers NLP model not found or broken. Try to generate a new one: "npm run train"\n'
        )
      } else {
        LogHelper.success('Found and valid\n')
      }

      /**
       * Main NLP model checking
       */

      LogHelper.info('Main NLP model state')

      if (
        !fs.existsSync(mainNlpModelPath) ||
        !Object.keys(fs.readFileSync(mainNlpModelPath)).length
      ) {
        report.can_text.v = false
        Object.keys(report).forEach((item) => {
          if (item.indexOf('stt') !== -1 || item.indexOf('tts') !== -1)
            report[item].v = false
        })
        LogHelper.error(
          'Main NLP model not found or broken. Try to generate a new one: "npm run train"\n'
        )
      } else {
        LogHelper.success('Found and valid\n')
      }

      /**
       * TTS/STT checking
       */

      LogHelper.info('Amazon Polly TTS')

      try {
        const json = JSON.parse(fs.readFileSync(amazonPath))
        if (
          json.credentials.accessKeyId === '' ||
          json.credentials.secretAccessKey === ''
        ) {
          report.can_amazon_polly_tts.v = false
          LogHelper.warning('Amazon Polly TTS is not yet configured\n')
        } else {
          LogHelper.success('Configured\n')
        }
      } catch (e) {
        report.can_amazon_polly_tts.v = false
        LogHelper.warning(`Amazon Polly TTS is not yet configured: ${e}\n`)
      }

      LogHelper.info('Google Cloud TTS/STT')

      try {
        const json = JSON.parse(fs.readFileSync(googleCloudPath))
        const results = []
        Object.keys(json).forEach((item) => {
          if (json[item] === '') results.push(false)
        })
        if (results.includes(false)) {
          report.can_google_cloud_tts.v = false
          report.can_google_cloud_stt.v = false
          LogHelper.warning('Google Cloud TTS/STT is not yet configured\n')
        } else {
          LogHelper.success('Configured\n')
        }
      } catch (e) {
        report.can_google_cloud_tts.v = false
        report.can_google_cloud_stt.v = false
        LogHelper.warning(`Google Cloud TTS/STT is not yet configured: ${e}\n`)
      }

      LogHelper.info('Watson TTS')

      try {
        const json = JSON.parse(fs.readFileSync(watsonTtsPath))
        const results = []
        Object.keys(json).forEach((item) => {
          if (json[item] === '') results.push(false)
        })
        if (results.includes(false)) {
          report.can_watson_tts.v = false
          LogHelper.warning('Watson TTS is not yet configured\n')
        } else {
          LogHelper.success('Configured\n')
        }
      } catch (e) {
        report.can_watson_tts.v = false
        LogHelper.warning(`Watson TTS is not yet configured: ${e}\n`)
      }

      LogHelper.info('Offline TTS')

      if (!fs.existsSync(flitePath)) {
        report.can_offline_tts.v = false
        LogHelper.warning(
          `Cannot find ${flitePath}. You can setup the offline TTS by running: "npm run setup:offline-tts"\n`
        )
      } else {
        LogHelper.success(`Found Flite at ${flitePath}\n`)
      }

      LogHelper.info('Watson STT')

      try {
        const json = JSON.parse(fs.readFileSync(watsonSttPath))
        const results = []
        Object.keys(json).forEach((item) => {
          if (json[item] === '') results.push(false)
        })
        if (results.includes(false)) {
          report.can_watson_stt.v = false
          LogHelper.warning('Watson STT is not yet configured\n')
        } else {
          LogHelper.success('Configured\n')
        }
      } catch (e) {
        report.can_watson_stt.v = false
        LogHelper.warning(`Watson STT is not yet configured: ${e}`)
      }

      LogHelper.info('Offline STT')

      if (!fs.existsSync(coquiLanguageModelPath)) {
        report.can_offline_stt.v = false
        LogHelper.warning(
          `Cannot find ${coquiLanguageModelPath}. You can setup the offline STT by running: "npm run setup:offline-stt"`
        )
      } else {
        LogHelper.success(
          `Found Coqui language model at ${coquiLanguageModelPath}`
        )
      }

      /**
       * Report
       */

      LogHelper.title('Report')

      LogHelper.info('Here is the diagnosis about your current setup')
      Object.keys(report).forEach((item) => {
        if (report[item].v === true) {
          LogHelper.success(report[item].title)
        } else {
          LogHelper[report[item].type](report[item].title)
        }
      })

      LogHelper.default('')
      if (report.can_run.v && report.can_run_skill.v && report.can_text.v) {
        LogHelper.success('Hooray! Leon can run correctly')
        LogHelper.info(
          'If you have some yellow warnings, it is all good. It means some entities are not yet configured'
        )
      } else {
        LogHelper.error('Please fix the errors above')
      }

      resolve()
    } catch (e) {
      LogHelper.error(e)
      reject()
    }
  })
