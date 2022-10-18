import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'

import dotenv from 'dotenv'
import { command } from 'execa'
import semver from 'semver'
import kill from 'tree-kill'
import request from 'superagent'

import { version } from '@@/package.json'
import { LogHelper } from '@/helpers/log-helper'
import {
  PYTHON_BRIDGE_BIN_PATH,
  TCP_SERVER_BIN_PATH,
  TCP_SERVER_VERSION,
  PYTHON_BRIDGE_VERSION
} from '@/constants'

dotenv.config()

/**
 * Checking script
 * Help to figure out the setup state
 */
;(async () => {
  try {
    const nodeMinRequiredVersion = '16'
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
    const pastebinData = {
      leonVersion: null,
      environment: {
        osDetails: null,
        nodeVersion: null,
        npmVersion: null
      },
      nlpModels: {
        globalResolversModelState: null,
        skillsResolversModelState: null,
        mainModelState: null
      },
      pythonBridge: {
        version: null,
        executionTime: null,
        command: null,
        output: null,
        error: null
      },
      tcpServer: {
        version: null,
        startTime: null,
        command: null,
        output: null,
        error: null
      },
      report: null
    }
    const report = {
      can_run: { title: 'Run', type: 'error', v: true },
      can_run_skill: { title: 'Run skills', type: 'error', v: true },
      can_text: { title: 'Reply you by texting', type: 'error', v: true },
      can_start_tcp_server: {
        title: 'Start the TCP server',
        type: 'error',
        v: true
      },
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
    pastebinData.leonVersion = version

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
    pastebinData.environment.osDetails = osInfo
    ;(
      await Promise.all([
        command('node --version', { shell: true }),
        command('npm --version', { shell: true })
      ])
    ).forEach((p) => {
      LogHelper.info(p.command)

      if (
        p.command.indexOf('node --version') !== -1 &&
        !semver.satisfies(semver.clean(p.stdout), `>=${nodeMinRequiredVersion}`)
      ) {
        Object.keys(report).forEach((item) => {
          if (report[item].type === 'error') report[item].v = false
        })
        LogHelper.error(
          `${p.stdout}\nThe Node.js version must be >=${nodeMinRequiredVersion}. Please install it: https://nodejs.org (or use nvm)\n`
        )
      } else if (
        p.command.indexOf('npm --version') !== -1 &&
        !semver.satisfies(semver.clean(p.stdout), `>=${npmMinRequiredVersion}`)
      ) {
        Object.keys(report).forEach((item) => {
          if (report[item].type === 'error') report[item].v = false
        })
        LogHelper.error(
          `${p.stdout}\nThe npm version must be >=${npmMinRequiredVersion}. Please install it: https://www.npmjs.com/get-npm (or use nvm)\n`
        )
      } else {
        LogHelper.success(`${p.stdout}\n`)
        if (p.command.includes('node --version')) {
          pastebinData.environment.nodeVersion = p.stdout
        } else if (p.command.includes('npm --version')) {
          pastebinData.environment.npmVersion = p.stdout
        }
      }
    })

    /**
     * Skill execution checking
     */

    LogHelper.success(`Python bridge version: ${PYTHON_BRIDGE_VERSION}`)
    pastebinData.pythonBridge.version = PYTHON_BRIDGE_VERSION
    LogHelper.info('Executing a skill...')

    try {
      const executionStart = Date.now()
      const p = await command(
        `${PYTHON_BRIDGE_BIN_PATH} scripts/assets/intent-object.json`,
        { shell: true }
      )
      const executionEnd = Date.now()
      const executionTime = executionEnd - executionStart
      LogHelper.info(p.command)
      pastebinData.pythonBridge.command = p.command
      LogHelper.success(p.stdout)
      pastebinData.pythonBridge.output = p.stdout
      LogHelper.info(`Skill execution time: ${executionTime}ms\n`)
      pastebinData.pythonBridge.executionTime = `${executionTime}ms`
    } catch (e) {
      LogHelper.info(e.command)
      report.can_run_skill.v = false
      LogHelper.error(`${e}\n`)
      pastebinData.pythonBridge.error = JSON.stringify(e)
    }

    /**
     * TCP server startup checking
     */

    LogHelper.success(`TCP server version: ${TCP_SERVER_VERSION}`)
    pastebinData.tcpServer.version = TCP_SERVER_VERSION

    LogHelper.info('Starting the TCP server...')

    const tcpServerCommand = `${TCP_SERVER_BIN_PATH} en`
    const tcpServerStart = Date.now()
    const p = spawn(tcpServerCommand, { shell: true })

    LogHelper.info(tcpServerCommand)
    pastebinData.tcpServer.command = tcpServerCommand

    if (osInfo.platform === 'darwin') {
      LogHelper.info(
        'For the first start, it may take a few minutes to cold start the TCP server on macOS. No worries it is a one-time thing'
      )
    }

    let tcpServerOutput = ''

    p.stdout.on('data', (data) => {
      const newData = data.toString()
      tcpServerOutput += newData

      if (newData?.toLowerCase().includes('waiting for')) {
        kill(p.pid)
        LogHelper.success('The TCP server can successfully start')
      }
    })

    p.stderr.on('data', (data) => {
      const newData = data.toString()
      tcpServerOutput += newData
      report.can_start_tcp_server.v = false
      pastebinData.tcpServer.error = newData
      LogHelper.error(`Cannot start the TCP server: ${newData}`)
    })

    const timeout = 3 * 60_000
    // In case it takes too long, force kill
    setTimeout(() => {
      kill(p.pid)

      const error = `The TCP server timed out after ${timeout}ms`
      LogHelper.error(error)
      pastebinData.tcpServer.error = error
      report.can_start_tcp_server.v = false
    }, timeout)

    p.stdout.on('end', async () => {
      const tcpServerEnd = Date.now()
      pastebinData.tcpServer.output = tcpServerOutput
      pastebinData.tcpServer.startTime = `${tcpServerEnd - tcpServerStart}ms`
      LogHelper.info(
        `TCP server startup time: ${pastebinData.tcpServer.startTime}ms\n`
      )

      /**
       * Global resolvers NLP model checking
       */

      LogHelper.info('Global resolvers NLP model state')

      if (
        !fs.existsSync(globalResolversNlpModelPath) ||
        !Object.keys(fs.readFileSync(globalResolversNlpModelPath)).length
      ) {
        const state = 'Global resolvers NLP model not found or broken'

        report.can_text.v = false
        Object.keys(report).forEach((item) => {
          if (item.indexOf('stt') !== -1 || item.indexOf('tts') !== -1)
            report[item].v = false
        })
        LogHelper.error(
          `${state}. Try to generate a new one: "npm run train"\n`
        )
        pastebinData.nlpModels.globalResolversModelState = state
      } else {
        const state = 'Found and valid'

        LogHelper.success(`${state}\n`)
        pastebinData.nlpModels.globalResolversModelState = state
      }

      /**
       * Skills resolvers NLP model checking
       */

      LogHelper.info('Skills resolvers NLP model state')

      if (
        !fs.existsSync(skillsResolversNlpModelPath) ||
        !Object.keys(fs.readFileSync(skillsResolversNlpModelPath)).length
      ) {
        const state = 'Skills resolvers NLP model not found or broken'

        report.can_text.v = false
        Object.keys(report).forEach((item) => {
          if (item.indexOf('stt') !== -1 || item.indexOf('tts') !== -1)
            report[item].v = false
        })
        LogHelper.error(
          `${state}. Try to generate a new one: "npm run train"\n`
        )
        pastebinData.nlpModels.skillsResolversModelState = state
      } else {
        const state = 'Found and valid'

        LogHelper.success(`${state}\n`)
        pastebinData.nlpModels.skillsResolversModelState = state
      }

      /**
       * Main NLP model checking
       */

      LogHelper.info('Main NLP model state')

      if (
        !fs.existsSync(mainNlpModelPath) ||
        !Object.keys(fs.readFileSync(mainNlpModelPath)).length
      ) {
        const state = 'Main NLP model not found or broken'

        report.can_text.v = false
        Object.keys(report).forEach((item) => {
          if (item.indexOf('stt') !== -1 || item.indexOf('tts') !== -1)
            report[item].v = false
        })
        LogHelper.error(
          `${state}. Try to generate a new one: "npm run train"\n`
        )
        pastebinData.nlpModels.mainModelState = state
      } else {
        const state = 'Found and valid'

        LogHelper.success(`${state}\n`)
        pastebinData.nlpModels.mainModelState = state
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
      if (
        report.can_run.v &&
        report.can_run_skill.v &&
        report.can_text.v &&
        report.can_start_tcp_server.v
      ) {
        LogHelper.success('Hooray! Leon can run correctly')
        LogHelper.info(
          'If you have some yellow warnings, it is all good. It means some entities are not yet configured'
        )
      } else {
        LogHelper.error('Please fix the errors above')
      }

      pastebinData.report = report

      LogHelper.title('REPORT URL')

      LogHelper.info('Sending report...')

      try {
        const { body } = await request
          .post('http://localhost:3000/api/report')
          .send({
            report: pastebinData
          })
        const { data: reportData } = body

        LogHelper.success(`Report URL: ${reportData.reportUrl}`)
      } catch (e) {
        LogHelper.error(`Failed to send report: ${e}`)
      }

      process.exit(0)
    })
  } catch (e) {
    LogHelper.error(e)
  }
})()
