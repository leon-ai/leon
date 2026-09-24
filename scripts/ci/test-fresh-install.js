#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import {
  isDeepStrictEqual,
  stripVTControlCharacters
} from 'node:util'

const INSTALL_COMMAND =
  'stty rows 40 cols 120 && pnpm install --frozen-lockfile'
const INSTALL_TIMEOUT = 45 * 60 * 1_000
const REBUILD_TIMEOUT = 15 * 60 * 1_000
const BUILD_TIMEOUT = 10 * 60 * 1_000
const START_TIMEOUT = 2 * 60 * 1_000
const PROCESS_STOP_TIMEOUT = 5_000
const OUTPUT_BUFFER_LIMIT = 32_000
const INFERENCE_TIMEOUT = 22 * 60 * 1_000
const INFERENCE_SCRIPT = 'scripts/ci/fresh-install-inferences.ts'
const DEFAULT_LOG_PATH = '/tmp/leon-fresh-install.log'
const MODULES_STATE_PATH = path.join('node_modules', '.modules.yaml')
const SERVER_READY_MESSAGE = 'Server is available at '
const JQ_SENTINEL_INPUT = {
  lifecycleScripts: 'available'
}
const SCRIPT_ARGUMENTS = [
  '--quiet',
  '--return',
  '--flush',
  '--echo',
  'never',
  '--command',
  INSTALL_COMMAND,
  '/dev/null'
]
const PROMPTS = [
  {
    name: 'local AI',
    text: 'Do you want me to set up local AI now?',
    response: 'n\r',
    required: false
  },
  {
    name: 'remote provider',
    text: 'Which online AI service should I use?',
    response: '\r',
    required: true
  },
  {
    name: 'remote model',
    text: 'Which model should I use with',
    response: '\r',
    required: true
  },
  {
    name: 'API key',
    text: 'I will save it in your local .env file.',
    response: null,
    required: true
  },
  {
    name: 'voice',
    text: 'Do you want to talk to me with your voice now?',
    response: 'n\r',
    required: true
  },
  {
    name: 'finish',
    text: 'What do you want to do next?',
    // Select Finish explicitly so a changed default cannot start Leon here.
    response: '\x1b[B\r',
    required: true
  }
]

let activeChild = null
let inferenceChild = null

function getCleanEnvironment() {
  const environment = { ...process.env }

  delete environment.GITHUB_ACTIONS
  delete environment.IS_DOCKER
  environment.CI = 'true'
  environment.COLUMNS = '120'
  environment.LINES = '40'

  return environment
}

function stopProcessGroup(child, signal = 'SIGTERM') {
  if (!child?.pid) {
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error
    }
  }
}

function stopActiveChildAndExit(signal) {
  if (inferenceChild) stopProcessGroup(inferenceChild)
  if (activeChild) {
    stopProcessGroup(activeChild, signal)
  }

  process.exit(signal === 'SIGINT' ? 130 : 143)
}

process.once('SIGINT', () => stopActiveChildAndExit('SIGINT'))
process.once('SIGTERM', () => stopActiveChildAndExit('SIGTERM'))

function ensureEmptyPNPMStore(environment) {
  const result = spawnSync('pnpm', ['store', 'path'], {
    encoding: 'utf8',
    env: environment
  })

  if (result.status !== 0) {
    throw new Error(`Unable to resolve pnpm store path: ${result.stderr}`)
  }

  const storePath = result.stdout.trim()

  if (fs.existsSync(storePath) && fs.readdirSync(storePath).length > 0) {
    throw new Error(`pnpm store is not empty: ${storePath}`)
  }

  console.log(`Fresh pnpm store confirmed: ${storePath}`)
}

function normalizeOutput(output) {
  return stripVTControlCharacters(output).replaceAll('\r', '')
}

/**
 * Redact complete lines before console or artifact output, including secrets
 * split across process output chunks. Installer prompts are handled separately.
 */
function forwardSafeOutput(source, destination, logStream) {
  const apiKey = process.env.LEON_FRESH_INSTALL_API_KEY?.trim()
  const lines = createInterface({ input: source, crlfDelay: Infinity })
  lines.on('line', (line) => {
    const normalized = normalizeOutput(line)
    const safeLine = apiKey ? normalized.replaceAll(apiKey, '[REDACTED]') : normalized
    destination.write(`${safeLine}\n`)
    logStream?.write(`${safeLine}\n`)
  })
}

function getPromptResponse(prompt, apiKey) {
  if (prompt.name === 'remote provider') {
    const result = spawnSync('pnpm', ['exec', 'tsx', INFERENCE_SCRIPT, 'provider-selection'], {
      encoding: 'utf8',
      timeout: START_TIMEOUT
    })
    if (result.status !== 0) throw new Error('Unable to resolve the DeepSeek setup choice')
    return result.stdout
  }
  return prompt.name === 'API key' ? `${apiKey}\r` : prompt.response
}

function runInteractiveInstall(environment, apiKey, logPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    const logStream = fs.createWriteStream(logPath)
    const answeredPrompts = new Set()
    let recentOutput = ''
    let hidingKeyInput = false
    let hasSettled = false
    const child = spawn('script', SCRIPT_ARGUMENTS, {
      detached: true,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    activeChild = child

    const finish = (error) => {
      if (hasSettled) {
        return
      }

      hasSettled = true
      clearTimeout(timeout)
      logStream.end()
      activeChild = null

      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    const handleOutput = (chunk, destination) => {
      // The text prompt echoes the key. Omit that entire phase, including
      // partial terminal redraws that ordinary full-secret masking misses.
      let visibleOutput = chunk.toString()
      if (hidingKeyInput) {
        const voicePrompt = PROMPTS.find((prompt) => prompt.name === 'voice').text
        const voiceIndex = normalizeOutput(`${recentOutput}${chunk}`).indexOf(voicePrompt)
        if (voiceIndex < 0) visibleOutput = ''
        else {
          hidingKeyInput = false
          visibleOutput = normalizeOutput(`${recentOutput}${chunk}`).slice(voiceIndex)
        }
      }
      visibleOutput = visibleOutput.replaceAll(apiKey, '[REDACTED]')
      destination.write(visibleOutput)
      logStream.write(visibleOutput)
      recentOutput = `${recentOutput}${chunk}`.slice(-OUTPUT_BUFFER_LIMIT)
      const normalizedOutput = normalizeOutput(recentOutput)

      for (const prompt of PROMPTS) {
        if (
          !answeredPrompts.has(prompt.name) &&
          normalizedOutput.includes(prompt.text)
        ) {
          try {
            if (prompt.name === 'API key') hidingKeyInput = true
            child.stdin.write(getPromptResponse(prompt, apiKey))
          } catch (error) {
            stopProcessGroup(child)
            finish(error)
            return
          }
          answeredPrompts.add(prompt.name)
          console.log(`\n[clean-install] Answered: ${prompt.name}`)
        }
      }
    }

    child.stdout.on('data', (chunk) => handleOutput(chunk, process.stdout))
    child.stderr.on('data', (chunk) => handleOutput(chunk, process.stderr))
    child.once('error', finish)
    child.once('close', (code, signal) => {
      if (code !== 0) {
        finish(
          new Error(
            `pnpm install exited with ${signal ? `signal ${signal}` : `code ${code}`}`
          )
        )
        return
      }

      const missingPrompts = PROMPTS.filter(
        (prompt) => prompt.required && !answeredPrompts.has(prompt.name)
      ).map((prompt) => prompt.name)

      if (missingPrompts.length > 0) {
        finish(
          new Error(
            `Installer did not present required prompts: ${missingPrompts.join(', ')}`
          )
        )
        return
      }

      finish()
    })

    const timeout = setTimeout(() => {
      stopProcessGroup(child)
      finish(new Error(`Installation exceeded ${INSTALL_TIMEOUT} ms`))
    }, INSTALL_TIMEOUT)
  })
}

function runCommand(command, args, environment, timeoutMs) {
  return new Promise((resolve, reject) => {
    let hasSettled = false
    const child = spawn(command, args, {
      detached: true,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    activeChild = child
    forwardSafeOutput(child.stdout, process.stdout)
    forwardSafeOutput(child.stderr, process.stderr)

    const finish = (error) => {
      if (hasSettled) {
        return
      }

      hasSettled = true
      clearTimeout(timeout)
      activeChild = null

      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    child.once('error', finish)
    child.once('close', (code, signal) => {
      if (code === 0) {
        finish()
        return
      }

      finish(
        new Error(
          `${command} ${args.join(' ')} exited with ${
            signal ? `signal ${signal}` : `code ${code}`
          }`
        )
      )
    })

    const timeout = setTimeout(() => {
      stopProcessGroup(child)
      finish(new Error(`${command} ${args.join(' ')} exceeded ${timeoutMs} ms`))
    }, timeoutMs)
  })
}

async function getPendingBuilds() {
  // The CI harness starts before dependencies exist, so load YAML after install.
  const { parse } = await import('yaml')
  const modulesState = parse(
    await fs.promises.readFile(MODULES_STATE_PATH, 'utf8')
  )
  const pendingBuilds = modulesState?.pendingBuilds

  if (pendingBuilds === undefined) {
    return []
  }

  if (
    !Array.isArray(pendingBuilds) ||
    pendingBuilds.some((packageId) => typeof packageId !== 'string')
  ) {
    throw new Error(`Invalid pendingBuilds in ${MODULES_STATE_PATH}`)
  }

  return pendingBuilds
}

async function verifyPendingBuilds(environment) {
  const initialPendingBuilds = await getPendingBuilds()

  if (initialPendingBuilds.length === 0) {
    console.log('No pending dependency builds found.')
    return
  }

  console.log(
    `Rebuilding pending dependencies: ${initialPendingBuilds.join(', ')}`
  )
  await runCommand(
    'pnpm',
    ['rebuild', '--pending'],
    environment,
    REBUILD_TIMEOUT
  )

  const remainingPendingBuilds = await getPendingBuilds()
  if (remainingPendingBuilds.length > 0) {
    throw new Error(
      `Pending dependency builds remain after rebuild: ${remainingPendingBuilds.join(', ')}`
    )
  }

  // A fresh install must work without requiring users to repair skipped builds.
  throw new Error(
    `Fresh installation left dependency builds pending: ${initialPendingBuilds.join(', ')}`
  )
}

async function verifyDependencyLifecycleScripts() {
  // node-jq downloads its executable during preinstall, making it a lifecycle sentinel.
  const { default: jq } = await import('node-jq')
  const output = await jq.run('.', JQ_SENTINEL_INPUT, {
    input: 'json',
    output: 'json'
  })

  if (!isDeepStrictEqual(output, JQ_SENTINEL_INPUT)) {
    throw new Error('node-jq lifecycle sentinel returned unexpected output')
  }

  console.log('Dependency lifecycle script sentinel passed.')
}

function smokeTestStart(environment, logPath) {
  return new Promise((resolve, reject) => {
    let hasSettled = false
    let isReady = false
    let inferenceError = null
    let inferenceComplete = false
    let inferenceTimeout = null
    const logStream = fs.createWriteStream(logPath, { flags: 'a' })
    let output = ''
    let forceStopTimeout = null
    const child = spawn('pnpm', ['start'], {
      detached: true,
      env: {
        ...environment,
        LEON_OPEN_BROWSER: 'false'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    activeChild = child

    const finish = (error) => {
      if (hasSettled) {
        return
      }

      hasSettled = true
      clearTimeout(startTimeout)
      clearTimeout(inferenceTimeout)
      if (inferenceChild) {
        stopProcessGroup(inferenceChild)
        inferenceChild = null
      }
      logStream.end()
      clearTimeout(forceStopTimeout)
      activeChild = null

      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    const handleOutput = (chunk) => {
      output = `${output}${chunk}`.slice(-OUTPUT_BUFFER_LIMIT)

      if (!isReady && normalizeOutput(output).includes(SERVER_READY_MESSAGE)) {
        isReady = true
        clearTimeout(startTimeout)
        inferenceChild = spawn('pnpm', ['exec', 'tsx', INFERENCE_SCRIPT, 'run'], {
          detached: true,
          env: environment,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        const stopServer = (error) => {
          if (inferenceComplete) return
          inferenceComplete = true
          inferenceError = error
          clearTimeout(inferenceTimeout)
          stopProcessGroup(child)
          forceStopTimeout = setTimeout(() => stopProcessGroup(child, 'SIGKILL'), PROCESS_STOP_TIMEOUT)
        }
        forwardSafeOutput(inferenceChild.stdout, process.stdout, logStream)
        forwardSafeOutput(inferenceChild.stderr, process.stderr, logStream)
        inferenceChild.once('error', stopServer)
        inferenceChild.once('close', (code) => {
          inferenceChild = null
          stopServer(code === 0 ? null : new Error(`Inference checks exited with code ${code}`))
        })
        inferenceTimeout = setTimeout(() => {
          stopProcessGroup(inferenceChild, 'SIGKILL')
          stopServer(new Error('Inference checks timed out'))
        }, INFERENCE_TIMEOUT)
      }
    }

    forwardSafeOutput(child.stdout, process.stdout, logStream)
    forwardSafeOutput(child.stderr, process.stderr, logStream)
    child.stdout.on('data', handleOutput)
    child.stderr.on('data', handleOutput)
    child.once('error', finish)
    child.once('close', (code, signal) => {
      if (inferenceComplete) {
        finish(inferenceError)
        return
      }

      finish(
        new Error(
          `pnpm start exited before inference checks completed with ${
            signal ? `signal ${signal}` : `code ${code}`
          }`
        )
      )
    })

    const startTimeout = setTimeout(() => {
      stopProcessGroup(child)
      finish(new Error(`pnpm start exceeded ${START_TIMEOUT} ms`))
    }, START_TIMEOUT)
  })
}

async function main() {
  const environment = getCleanEnvironment()
  const apiKey = process.env.LEON_FRESH_INSTALL_API_KEY?.trim()
  if (!apiKey) throw new Error('LEON_FRESH_INSTALL_API_KEY is required (GitHub secret LEON_DEEPSEEK_API_KEY)')
  const logPath =
    process.env.LEON_FRESH_INSTALL_LOG_PATH || DEFAULT_LOG_PATH

  ensureEmptyPNPMStore(environment)
  await runInteractiveInstall(environment, apiKey, logPath)
  await verifyPendingBuilds(environment)
  await verifyDependencyLifecycleScripts()
  await runCommand('pnpm', ['build'], environment, BUILD_TIMEOUT)
  await smokeTestStart(environment, logPath)
  console.log('Fresh installation, build, weather, and OCR verification passed.')
}

main().catch((error) => {
  if (inferenceChild) stopProcessGroup(inferenceChild)
  if (activeChild) {
    stopProcessGroup(activeChild)
  }

  console.error(error)
  process.exit(1)
})
