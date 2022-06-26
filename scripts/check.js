import dotenv from 'dotenv'
import fs from 'fs'
import { command } from 'execa'
import semver from 'semver'

import log from '@/helpers/log'

dotenv.config()

/**
 * Checking script
 * Help to figure out what is installed or not
 */
export default () => new Promise(async (resolve, reject) => {
  try {
    const nodeMinRequiredVersion = '10'
    const npmMinRequiredVersion = '5'
    const pythonMinRequiredVersion = '3'
    const flitePath = 'bin/flite/flite'
    const coquiLanguageModelPath = 'bin/coqui/huge-vocabulary.scorer'
    const amazonPath = 'core/config/voice/amazon.json'
    const googleCloudPath = 'core/config/voice/google-cloud.json'
    const watsonSttPath = 'core/config/voice/watson-stt.json'
    const watsonTtsPath = 'core/config/voice/watson-tts.json'
    const nlpModelPath = 'core/data/leon-model.nlp'
    const report = {
      can_run: { title: 'Run', type: 'error', v: true },
      can_run_module: { title: 'Run modules', type: 'error', v: true },
      can_text: { title: 'Reply you by texting', type: 'error', v: true },
      can_amazon_polly_tts: { title: 'Amazon Polly text-to-speech', type: 'warning', v: true },
      can_google_cloud_tts: { title: 'Google Cloud text-to-speech', type: 'warning', v: true },
      can_watson_tts: { title: 'Watson text-to-speech', type: 'warning', v: true },
      can_offline_tts: { title: 'Offline text-to-speech', type: 'warning', v: true },
      can_google_cloud_stt: { title: 'Google Cloud speech-to-text', type: 'warning', v: true },
      can_watson_stt: { title: 'Watson speech-to-text', type: 'warning', v: true },
      can_offline_stt: { title: 'Offline speech-to-text', type: 'warning', v: true }
    }

    log.title('Checking');

    // Environment checking

    (await Promise.all([
      command('node --version', { shell: true }),
      command('npm --version', { shell: true }),
      command('pipenv --version', { shell: true })
    ])).forEach((p) => {
      log.info(p.command)

      if (p.command.indexOf('node --version') !== -1
        && !semver.satisfies(semver.clean(p.stdout), `>=${nodeMinRequiredVersion}`)) {
        Object.keys(report).forEach((item) => { if (report[item].type === 'error') report[item].v = false })
        log.error(`${p.stdout}\nThe Node.js version must be >=${nodeMinRequiredVersion}. Please install it: https://nodejs.org (or use nvm)\n`)
      } else if (p.command.indexOf('npm --version') !== -1
        && !semver.satisfies(semver.clean(p.stdout), `>=${npmMinRequiredVersion}`)) {
        Object.keys(report).forEach((item) => { if (report[item].type === 'error') report[item].v = false })
        log.error(`${p.stdout}\nThe npm version must be >=${npmMinRequiredVersion}. Please install it: https://www.npmjs.com/get-npm (or use nvm)\n`)
      } else {
        log.success(`${p.stdout}\n`)
      }
    });

    (await Promise.all([
      command('pipenv --where', { shell: true }),
      command('pipenv run python --version', { shell: true })
    ])).forEach((p) => {
      log.info(p.command)

      if (p.command.indexOf('pipenv run python --version') !== -1
        && !semver.satisfies(p.stdout.split(' ')[1], `>=${pythonMinRequiredVersion}`)) {
        Object.keys(report).forEach((item) => { if (report[item].type === 'error') report[item].v = false })
        log.error(`${p.stdout}\nThe Python version must be >=${pythonMinRequiredVersion}. Please install it: https://www.python.org/downloads\n`)
      } else {
        log.success(`${p.stdout}\n`)
      }
    })

    // Module execution checking

    try {
      const p = await command('pipenv run python bridges/python/main.py scripts/assets/intent-object.json', { shell: true })
      log.info(p.command)
      log.success(`${p.stdout}\n`)
    } catch (e) {
      log.info(e.command)
      report.can_run_module.v = false
      log.error(`${e}\n`)
    }

    // NLP model checking

    log.info('NLP model state')
    if (!fs.existsSync(nlpModelPath) || !Object.keys(fs.readFileSync(nlpModelPath)).length) {
      report.can_text.v = false
      Object.keys(report).forEach((item) => { if (item.indexOf('stt') !== -1 || item.indexOf('tts') !== -1) report[item].v = false })
      log.error('NLP model not found or broken. Try to generate a new one: "npm run train"\n')
    } else {
      log.success('Found and valid\n')
    }

    // TTS checking

    log.info('Amazon Polly TTS')
    try {
      const json = JSON.parse(fs.readFileSync(amazonPath))
      if (json.credentials.accessKeyId === '' || json.credentials.secretAccessKey === '') {
        report.can_amazon_polly_tts.v = false
        log.warning('Amazon Polly TTS is not yet configured\n')
      } else {
        log.success('Configured\n')
      }
    } catch (e) {
      report.can_amazon_polly_tts.v = false
      log.warning(`Amazon Polly TTS is not yet configured: ${e}\n`)
    }

    log.info('Google Cloud TTS/STT')
    try {
      const json = JSON.parse(fs.readFileSync(googleCloudPath))
      const results = []
      Object.keys(json).forEach((item) => { if (json[item] === '') results.push(false) })
      if (results.includes(false)) {
        report.can_google_cloud_tts.v = false
        report.can_google_cloud_stt.v = false
        log.warning('Google Cloud TTS/STT is not yet configured\n')
      } else {
        log.success('Configured\n')
      }
    } catch (e) {
      report.can_google_cloud_tts.v = false
      report.can_google_cloud_stt.v = false
      log.warning(`Google Cloud TTS/STT is not yet configured: ${e}\n`)
    }

    log.info('Watson TTS')
    try {
      const json = JSON.parse(fs.readFileSync(watsonTtsPath))
      const results = []
      Object.keys(json).forEach((item) => { if (json[item] === '') results.push(false) })
      if (results.includes(false)) {
        report.can_watson_tts.v = false
        log.warning('Watson TTS is not yet configured\n')
      } else {
        log.success('Configured\n')
      }
    } catch (e) {
      report.can_watson_tts.v = false
      log.warning(`Watson TTS is not yet configured: ${e}\n`)
    }

    log.info('Offline TTS')
    if (!fs.existsSync(flitePath)) {
      report.can_offline_tts.v = false
      log.warning(`Cannot find ${flitePath}. You can setup the offline TTS by running: "npm run setup:offline-tts"\n`)
    } else {
      log.success(`Found Flite at ${flitePath}\n`)
    }

    log.info('Watson STT')
    try {
      const json = JSON.parse(fs.readFileSync(watsonSttPath))
      const results = []
      Object.keys(json).forEach((item) => { if (json[item] === '') results.push(false) })
      if (results.includes(false)) {
        report.can_watson_stt.v = false
        log.warning('Watson STT is not yet configured\n')
      } else {
        log.success('Configured\n')
      }
    } catch (e) {
      report.can_watson_stt.v = false
      log.warning(`Watson STT is not yet configured: ${e}`)
    }

    log.info('Offline STT')
    if (!fs.existsSync(coquiLanguageModelPath)) {
      report.can_offline_stt.v = false
      log.warning(`Cannot find ${coquiLanguageModelPath}. You can setup the offline STT by running: "npm run setup:offline-stt"`)
    } else {
      log.success(`Found Coqui language model at ${coquiLanguageModelPath}`)
    }

    // Report
    log.title('Report')

    log.info('Here is the diagnosis about your current setup')
    Object.keys(report).forEach((item) => {
      if (report[item].v === true) {
        log.success(report[item].title)
      } else {
        log[report[item].type](report[item].title)
      }
    })

    log.default('')
    if (report.can_run.v && report.can_run_module.v && report.can_text.v) {
      log.success('Hooray! Leon can run correctly')
      log.info('If you have some yellow warnings, it is all good. It means some entities are not yet configured')
    } else {
      log.error('Please fix the errors above')
    }

    resolve()
  } catch (e) {
    log.error(e)
    reject()
  }
})
