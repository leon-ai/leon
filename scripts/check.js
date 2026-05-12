import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import dotenv from 'dotenv'
import execa from 'execa'
import semver from 'semver'
import kill from 'tree-kill'

import { LogHelper } from '@/helpers/log-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { shouldIgnoreTCPServerError } from '@/utilities'
import {
  MINIMUM_REQUIRED_RAM,
  LEON_VERSION,
  INSTANCE_ID,
  NODE_VERSION,
  PNPM_VERSION,
  PYTHON_VERSION,
  UV_VERSION,
  NODE_RUNTIME_BIN_PATH,
  PNPM_RUNTIME_BIN_PATH,
  PYTHON_RUNTIME_BIN_PATH,
  UV_RUNTIME_BIN_PATH,
  NODEJS_BRIDGE_ENTRY_PATH,
  NODEJS_BRIDGE_VERSION,
  PYTHON_BRIDGE_ENTRY_PATH,
  PYTHON_BRIDGE_RUNTIME_BIN_PATH,
  PYTHON_BRIDGE_VERSION,
  PYTHON_TCP_SERVER_ENTRY_PATH,
  PYTHON_TCP_SERVER_RUNTIME_BIN_PATH,
  PYTHON_TCP_SERVER_VERSION,
  PYTHON_TCP_SERVER_SETTINGS,
  PYTHON_TCP_SERVER_TTS_MODEL_DIR_PATH,
  PYTHON_TCP_SERVER_TTS_MODEL_PATH,
  PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH,
  PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH,
  AUDIO_MODELS_PATH,
  PROFILE_DOT_ENV_PATH,
  TSX_CLI_PATH,
  LANG,
  HAS_STT,
  HAS_TTS,
  SHOULD_START_PYTHON_TCP_SERVER,
  LEON_ROUTING_MODE,
  WORKFLOW_LLM_TARGET,
  AGENT_LLM_TARGET,
  NATIVE_SKILLS_PATH,
  PYTORCH_TORCH_PATH,
  NVIDIA_CUBLAS_PATH,
  NVIDIA_CUDNN_PATH,
  NVIDIA_CUSPARSE_PATH,
  NVIDIA_CUSPARSE_FULL_PATH,
  NVIDIA_NCCL_PATH,
  NVIDIA_NVJITLINK_PATH,
  NVIDIA_NVSHMEM_PATH
} from '@/constants'

dotenv.config({ path: PROFILE_DOT_ENV_PATH })

const CHECK_TMP_DIR_PATH = path.join(process.cwd(), 'scripts', 'tmp')
const PYTHON_TCP_SERVER_TTS_MODEL_CONFIG_PATH = path.join(
  PYTHON_TCP_SERVER_TTS_MODEL_DIR_PATH,
  'config.json'
)
const PYTHON_TCP_SERVER_WAKE_WORD_MODEL_DIR_PATH = path.join(
  AUDIO_MODELS_PATH,
  'wake_word'
)
const PYTHON_TCP_SERVER_WAKE_WORD_MODEL_PATH = path.join(
  PYTHON_TCP_SERVER_WAKE_WORD_MODEL_DIR_PATH,
  PYTHON_TCP_SERVER_SETTINGS.wake_word.model_file_name
)
const PYTHON_TCP_SERVER_WAKE_WORD_MELSPEC_PATH = path.join(
  PYTHON_TCP_SERVER_WAKE_WORD_MODEL_DIR_PATH,
  'melspectrogram.onnx'
)
const PYTHON_TCP_SERVER_WAKE_WORD_EMBEDDING_PATH = path.join(
  PYTHON_TCP_SERVER_WAKE_WORD_MODEL_DIR_PATH,
  'embedding.onnx'
)

function createCheckResult(title, severity = 'error') {
  return {
    title,
    severity,
    ok: true,
    details: []
  }
}

function addFailure(result, detail) {
  result.ok = false
  result.details.push(detail)
}

function addDetail(result, detail) {
  result.details.push(detail)
}

function getFormattedCheckStatus(check) {
  if (check.ok) {
    return 'ok'
  }

  return check.severity === 'warning' ? 'warning' : 'error'
}

function extractFirstVersion(rawOutput) {
  const match = rawOutput.match(/\d+\.\d+\.\d+/)
  return match ? match[0] : null
}

async function getCommandVersion(executablePath, args = []) {
  const result = await execa(executablePath, args)

  return {
    raw: result.stdout.trim(),
    version: extractFirstVersion(result.stdout.trim())
  }
}

async function writeCheckIntentObject(fileName, intentObject) {
  await fs.promises.mkdir(CHECK_TMP_DIR_PATH, { recursive: true })

  const filePath = path.join(CHECK_TMP_DIR_PATH, fileName)
  await fs.promises.writeFile(filePath, JSON.stringify(intentObject, null, 2))

  return filePath
}

function buildExtraContext(lang) {
  const now = new Date()

  return {
    lang,
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 8),
    timestamp: now.getTime(),
    date_time: now.toISOString(),
    week_day: now.toLocaleDateString('en-US', { weekday: 'long' })
  }
}

async function createNodejsBridgeIntentObject() {
  const skillConfigPath = path.join(
    NATIVE_SKILLS_PATH,
    'date_time_skill',
    'skill.json'
  )
  const skillConfig = JSON.parse(await fs.promises.readFile(skillConfigPath, 'utf8'))

  return writeCheckIntentObject('check-nodejs-bridge-intent-object.json', {
    id: 'check-nodejs-bridge',
    lang: 'en',
    context_name: 'date_time',
    skill_name: 'date_time_skill',
    action_name: 'current_time',
    skill_config: skillConfig,
    skill_config_path: skillConfigPath,
    utterance: 'What time is it?',
    entities: [],
    action_arguments: {},
    sentiment: {
      vote: 'neutral',
      score: 0
    },
    context: {
      utterances: ['What time is it?'],
      action_arguments: [{}],
      entities: [],
      sentiments: [{ vote: 'neutral', score: 0 }],
      data: {}
    },
    extra_context: buildExtraContext('en')
  })
}

async function createPythonBridgeIntentObject() {
  const skillConfigPath = path.join(
    NATIVE_SKILLS_PATH,
    'color_skill',
    'skill.json'
  )
  const skillConfig = JSON.parse(await fs.promises.readFile(skillConfigPath, 'utf8'))

  return writeCheckIntentObject('check-python-bridge-intent-object.json', {
    id: 'check-python-bridge',
    lang: 'en',
    context_name: 'color',
    skill_name: 'color_skill',
    action_name: 'tell_hexadecimal_color',
    skill_config: skillConfig,
    skill_config_path: skillConfigPath,
    utterance: 'What is the hexadecimal color for red?',
    entities: [],
    action_arguments: {
      color_name: 'red'
    },
    sentiment: {
      vote: 'neutral',
      score: 0
    },
    context: {
      utterances: ['What is the hexadecimal color for red?'],
      action_arguments: [{ color_name: 'red' }],
      entities: [],
      sentiments: [{ vote: 'neutral', score: 0 }],
      data: {}
    },
    extra_context: buildExtraContext('en')
  })
}

async function runNodejsBridgeCheck(intentObjectPath) {
  return execa(NODE_RUNTIME_BIN_PATH, [
      TSX_CLI_PATH,
      NODEJS_BRIDGE_ENTRY_PATH,
      '--runtime',
      'skill',
      intentObjectPath
    ])
}

async function runPythonBridgeCheck(intentObjectPath) {
  return execa(PYTHON_BRIDGE_RUNTIME_BIN_PATH, [
      PYTHON_BRIDGE_ENTRY_PATH,
      intentObjectPath
    ])
}

function buildTCPServerEnv() {
  const env = { ...process.env }

  if (SystemHelper.isLinux()) {
    const torchLibPath = `${PYTORCH_TORCH_PATH}/lib`
    const nvidiaLibPaths = [
      `${NVIDIA_CUBLAS_PATH}/lib`,
      `${NVIDIA_CUDNN_PATH}/lib`,
      `${NVIDIA_CUSPARSE_PATH}/lib`,
      `${NVIDIA_CUSPARSE_FULL_PATH}/lib`,
      `${NVIDIA_NCCL_PATH}/lib`,
      `${NVIDIA_NVSHMEM_PATH}/lib`,
      `${NVIDIA_NVJITLINK_PATH}/lib`
    ]

    env['LD_LIBRARY_PATH'] = [torchLibPath, ...nvidiaLibPaths, env['LD_LIBRARY_PATH']]
      .filter(Boolean)
      .join(':')
  }

  return env
}

function startTCPServerCheck() {
  const args = [PYTHON_TCP_SERVER_ENTRY_PATH, LANG || 'en']
  const env = buildTCPServerEnv()
  const commandString = RuntimeHelper.buildShellCommand(
    PYTHON_TCP_SERVER_RUNTIME_BIN_PATH,
    args
  )

  return new Promise((resolve) => {
    const child = spawn(PYTHON_TCP_SERVER_RUNTIME_BIN_PATH, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    const timeoutMs = 3 * 60_000
    let output = ''
    let resolved = false

    const finish = (result) => {
      if (resolved) {
        return
      }

      resolved = true
      clearTimeout(timeoutId)

      if (child.pid) {
        kill(child.pid)
      }

      resolve({
        command: commandString,
        ...result
      })
    }

    const timeoutId = setTimeout(() => {
      finish({
        ok: false,
        output,
        error: `The Python TCP server timed out after ${timeoutMs}ms`
      })
    }, timeoutMs)

    child.stdout.on('data', (data) => {
      const text = data.toString()
      output += text

      if (text.toLowerCase().includes('waiting for connection')) {
        finish({
          ok: true,
          output,
          error: null
        })
      }
    })

    child.stderr.on('data', (data) => {
      const text = data.toString()

      if (shouldIgnoreTCPServerError(text)) {
        output += text
        return
      }

      output += text
      finish({
        ok: false,
        output,
        error: text.trim() || 'Unknown TCP server startup error'
      })
    })

    child.on('error', (error) => {
      finish({
        ok: false,
        output,
        error: String(error)
      })
    })

    child.on('exit', (code) => {
      if (!resolved) {
        finish({
          ok: false,
          output,
          error: `The Python TCP server exited before becoming ready (code: ${code ?? 'unknown'})`
        })
      }
    })
  })
}

function validateLocalLLMTarget(target, label, result) {
  if (!target.isEnabled) {
    addDetail(result, `${label}: disabled`)
    return
  }

  if (!target.isLocal) {
    addDetail(result, `${label}: ${target.label}`)
    return
  }

  if (!target.isResolved) {
    addFailure(
      result,
      `${label}: ${target.resolutionError || 'local model is not configured or installed yet'}`
    )
    return
  }

  if (!fs.existsSync(target.model)) {
    addFailure(
      result,
      `${label}: local model not found at ${target.model}`
    )
    return
  }

  addDetail(result, `${label}: ${target.label}`)
}

function checkTCPServerAssets() {
  const result = createCheckResult('Python TCP server assets')

  if (HAS_TTS) {
    if (!fs.existsSync(PYTHON_TCP_SERVER_TTS_MODEL_CONFIG_PATH)) {
      addFailure(
        result,
        `Missing TTS config at ${PYTHON_TCP_SERVER_TTS_MODEL_CONFIG_PATH}`
      )
    }

    if (!fs.existsSync(PYTHON_TCP_SERVER_TTS_MODEL_PATH)) {
      addFailure(
        result,
        `Missing TTS model at ${PYTHON_TCP_SERVER_TTS_MODEL_PATH}`
      )
    }

    if (!fs.existsSync(PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH)) {
      addFailure(
        result,
        `Missing TTS BERT base directory at ${PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH}`
      )
    }
  }

  if (HAS_STT && !fs.existsSync(PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH)) {
    addFailure(
      result,
      `Missing ASR model directory at ${PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH}`
    )
  }

  if (process.env['LEON_WAKE_WORD'] === 'true') {
    if (!fs.existsSync(PYTHON_TCP_SERVER_WAKE_WORD_MODEL_PATH)) {
      addFailure(
        result,
        `Missing wake word model at ${PYTHON_TCP_SERVER_WAKE_WORD_MODEL_PATH}`
      )
    }

    if (!fs.existsSync(PYTHON_TCP_SERVER_WAKE_WORD_MELSPEC_PATH)) {
      addFailure(
        result,
        `Missing wake word melspectrogram model at ${PYTHON_TCP_SERVER_WAKE_WORD_MELSPEC_PATH}`
      )
    }

    if (!fs.existsSync(PYTHON_TCP_SERVER_WAKE_WORD_EMBEDDING_PATH)) {
      addFailure(
        result,
        `Missing wake word embedding model at ${PYTHON_TCP_SERVER_WAKE_WORD_EMBEDDING_PATH}`
      )
    }
  }

  if (result.ok) {
    addDetail(
      result,
      `STT=${HAS_STT ? 'enabled' : 'disabled'}, TTS=${HAS_TTS ? 'enabled' : 'disabled'}, wake_word=${process.env['LEON_WAKE_WORD'] === 'true' ? 'enabled' : 'disabled'}`
    )
  }

  return result
}

function printCheckResult(result) {
  const status = getFormattedCheckStatus(result)

  if (status === 'ok') {
    LogHelper.success(result.title)
  } else if (status === 'warning') {
    LogHelper.warning(result.title)
  } else {
    LogHelper.error(result.title)
  }

  result.details.forEach((detail) => {
    LogHelper.default(`- ${detail}`)
  })
}

;(async () => {
  const checks = {
    canRun: createCheckResult('Run Leon'),
    hardware: createCheckResult('Hardware'),
    managedNode: createCheckResult('Managed Node.js runtime'),
    managedPNPM: createCheckResult('Managed pnpm runtime'),
    managedPython: createCheckResult('Managed Python runtime'),
    managedUV: createCheckResult('Managed uv runtime'),
    llmTargets: createCheckResult('LLM target configuration'),
    nodeJSBridge: createCheckResult('Node.js bridge smoke test'),
    pythonBridge: createCheckResult('Python bridge smoke test'),
    pythonTCPServerAssets: createCheckResult('Python TCP server assets'),
    pythonTCPServer: createCheckResult('Python TCP server boot')
  }

  const summary = {
    leonVersion: LEON_VERSION || null,
    instanceID: INSTANCE_ID || null,
    environment: {
      os: SystemHelper.getInformation(),
      release: os.release(),
      cpus: os.cpus().length,
      totalRAMInGB: SystemHelper.getTotalRAM(),
      freeRAMInGB: SystemHelper.getFreeRAM()
    },
    hardware: {},
    runtimes: {},
    llm: {
      routingMode: LEON_ROUTING_MODE,
      workflow: WORKFLOW_LLM_TARGET.label,
      agent: AGENT_LLM_TARGET.label
    },
    nodeJSBridge: {},
    pythonBridge: {},
    pythonTCPServer: {}
  }

  LogHelper.title('Checking')

  LogHelper.info('Leon version')
  LogHelper.success(String(LEON_VERSION))

  LogHelper.info('Environment')
  LogHelper.success(JSON.stringify(summary.environment))

  try {
    const [
      gpuDeviceNames,
      graphicsComputeAPI,
      totalVRAM,
      freeVRAM,
      usedVRAM,
      canSupportLocalLLM
    ] = await Promise.all([
      SystemHelper.getGPUDeviceNames(),
      SystemHelper.getGraphicsComputeAPI(),
      SystemHelper.getTotalVRAM(),
      SystemHelper.getFreeVRAM(),
      SystemHelper.getUsedVRAM(),
      SystemHelper.canSupportLocalLLM()
    ])

    summary.hardware = {
      gpuDeviceNames,
      graphicsComputeAPI,
      totalVRAMInGB: totalVRAM,
      freeVRAMInGB: freeVRAM,
      usedVRAMInGB: usedVRAM,
      canSupportLocalLLM
    }

    addDetail(
      checks.hardware,
      `GPU: ${gpuDeviceNames.length > 0 ? gpuDeviceNames.join(', ') : 'none'}`
    )
    addDetail(checks.hardware, `Compute API: ${graphicsComputeAPI}`)
    addDetail(
      checks.hardware,
      `VRAM: total=${totalVRAM} GB | free=${freeVRAM} GB | used=${usedVRAM} GB`
    )
    addDetail(
      checks.hardware,
      `Local LLM support: ${canSupportLocalLLM ? 'yes' : 'no'}`
    )
  } catch (error) {
    checks.hardware.severity = 'warning'
    addFailure(
      checks.hardware,
      `Unable to inspect GPU/VRAM information: ${String(error)}`
    )
  }

  if (Math.round(summary.environment.freeRAMInGB) < MINIMUM_REQUIRED_RAM) {
    addFailure(
      checks.canRun,
      `Free RAM is ${summary.environment.freeRAMInGB} GB but Leon needs at least ${MINIMUM_REQUIRED_RAM} GB`
    )
  } else {
    addDetail(
      checks.canRun,
      `Free RAM: ${summary.environment.freeRAMInGB} GB | Total RAM: ${summary.environment.totalRAMInGB} GB`
    )
  }

  const runtimeChecks = [
    {
      key: 'managedNode',
      label: 'node',
      executablePath: NODE_RUNTIME_BIN_PATH,
      expectedVersion: NODE_VERSION
    },
    {
      key: 'managedPNPM',
      label: 'pnpm',
      executablePath: PNPM_RUNTIME_BIN_PATH,
      expectedVersion: PNPM_VERSION
    },
    {
      key: 'managedPython',
      label: 'python',
      executablePath: PYTHON_RUNTIME_BIN_PATH,
      expectedVersion: PYTHON_VERSION
    },
    {
      key: 'managedUV',
      label: 'uv',
      executablePath: UV_RUNTIME_BIN_PATH,
      expectedVersion: UV_VERSION
    }
  ]

  for (const runtimeCheck of runtimeChecks) {
    const result = checks[runtimeCheck.key]

    if (!fs.existsSync(runtimeCheck.executablePath)) {
      addFailure(
        result,
        `Runtime not found at ${runtimeCheck.executablePath}`
      )
      continue
    }

    try {
      const { raw, version } = await getCommandVersion(
        runtimeCheck.executablePath,
        ['--version']
      )
      summary.runtimes[runtimeCheck.label] = {
        path: runtimeCheck.executablePath,
        version: raw
      }

      addDetail(result, `Path: ${runtimeCheck.executablePath}`)
      addDetail(result, `Version: ${raw}`)

      const expectedVersion = extractFirstVersion(runtimeCheck.expectedVersion)
      if (
        expectedVersion &&
        version &&
        semver.valid(semver.coerce(version)) &&
        semver.valid(semver.coerce(expectedVersion)) &&
        semver.neq(
          semver.coerce(version),
          semver.coerce(expectedVersion)
        )
      ) {
        addFailure(
          result,
          `Expected ${expectedVersion} but got ${version}`
        )
      }
    } catch (error) {
      addFailure(result, String(error))
    }
  }

  if (!fs.existsSync(TSX_CLI_PATH)) {
    addFailure(
      checks.nodeJSBridge,
      `Missing tsx CLI at ${TSX_CLI_PATH}`
    )
  }

  validateLocalLLMTarget(WORKFLOW_LLM_TARGET, 'Workflow', checks.llmTargets)
  validateLocalLLMTarget(AGENT_LLM_TARGET, 'Agent', checks.llmTargets)

  const pythonTCPServerAssetsResult = checkTCPServerAssets()
  checks.pythonTCPServerAssets = pythonTCPServerAssetsResult

  let nodeIntentObjectPath = null
  let pythonIntentObjectPath = null

  try {
    nodeIntentObjectPath = await createNodejsBridgeIntentObject()

    const executionStart = Date.now()
    const result = await runNodejsBridgeCheck(nodeIntentObjectPath)
    const executionTime = Date.now() - executionStart
    const combinedOutput = `${result.stdout}\n${result.stderr}`.trim()

    summary.nodeJSBridge = {
      version: NODEJS_BRIDGE_VERSION,
      command: result.command,
      executionTimeMs: executionTime,
      output: combinedOutput
    }

    addDetail(checks.nodeJSBridge, `Version: ${NODEJS_BRIDGE_VERSION}`)
    addDetail(checks.nodeJSBridge, `Execution time: ${executionTime}ms`)

    if (
      combinedOutput.includes('Error while running') ||
      combinedOutput.trim() === ''
    ) {
      addFailure(
        checks.nodeJSBridge,
        combinedOutput || 'The Node.js bridge did not produce any output'
      )
    }
  } catch (error) {
    addFailure(checks.nodeJSBridge, String(error))
  }

  try {
    pythonIntentObjectPath = await createPythonBridgeIntentObject()

    const executionStart = Date.now()
    const result = await runPythonBridgeCheck(pythonIntentObjectPath)
    const executionTime = Date.now() - executionStart
    const combinedOutput = `${result.stdout}\n${result.stderr}`.trim()

    summary.pythonBridge = {
      version: PYTHON_BRIDGE_VERSION,
      command: result.command,
      executionTimeMs: executionTime,
      output: combinedOutput
    }

    addDetail(checks.pythonBridge, `Version: ${PYTHON_BRIDGE_VERSION}`)
    addDetail(checks.pythonBridge, `Execution time: ${executionTime}ms`)

    if (
      combinedOutput.includes('Error while running') ||
      combinedOutput.includes('Traceback') ||
      combinedOutput.trim() === ''
    ) {
      addFailure(
        checks.pythonBridge,
        combinedOutput || 'The Python bridge did not produce any output'
      )
    }
  } catch (error) {
    addFailure(checks.pythonBridge, String(error))
  }

  if (SHOULD_START_PYTHON_TCP_SERVER) {
    try {
      const startupStart = Date.now()
      const result = await startTCPServerCheck()
      const startupTime = Date.now() - startupStart

      summary.pythonTCPServer = {
        version: PYTHON_TCP_SERVER_VERSION,
        command: result.command,
        startupTimeMs: startupTime,
        output: result.output
      }

      addDetail(checks.pythonTCPServer, `Version: ${PYTHON_TCP_SERVER_VERSION}`)
      addDetail(checks.pythonTCPServer, `Startup time: ${startupTime}ms`)

      if (!result.ok) {
        addFailure(
          checks.pythonTCPServer,
          result.error || 'The Python TCP server did not become ready'
        )
      }
    } catch (error) {
      addFailure(checks.pythonTCPServer, String(error))
    }
  } else {
    checks.pythonTCPServer.severity = 'warning'
    addDetail(
      checks.pythonTCPServer,
      'Skipped because neither STT nor TTS is enabled'
    )
  }

  for (const check of Object.values(checks)) {
    printCheckResult(check)
  }

  const criticalFailures = Object.values(checks).some(
    (check) => check.severity === 'error' && !check.ok
  )

  LogHelper.title('Summary')

  if (criticalFailures || !checks.canRun.ok) {
    LogHelper.error('Please fix the errors above')
  } else {
    LogHelper.success('Hooray! Leon can run correctly')
  }

  try {
    if (nodeIntentObjectPath) {
      await fs.promises.rm(nodeIntentObjectPath, { force: true })
    }
    if (pythonIntentObjectPath) {
      await fs.promises.rm(pythonIntentObjectPath, { force: true })
    }
  } catch {
    // Ignore cleanup failures for temporary check fixtures.
  }

  process.exit(criticalFailures || !checks.canRun.ok ? 1 : 0)
})().catch((error) => {
  LogHelper.title('Checking')
  LogHelper.error(`Unexpected error: ${error}`)
  process.exit(1)
})
