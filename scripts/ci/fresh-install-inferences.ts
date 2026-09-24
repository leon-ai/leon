import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { io, type Socket } from 'socket.io-client'
import { parse } from 'yaml'

import { LEON_PROFILE_NAME, PROFILE_CONFIG_PATH } from '@/leon-roots'
import { readStoredProfileToken } from '@/core/profile-auth'
import { PROFILE_TOKEN_SEPARATOR } from '@/core/profile-runtime/profile-paths'
import {
  LEON_CLIENT_INTERFACE_EVENTS as EVENTS,
  LEON_CLIENT_INTERFACE_PROTOCOL_VERSION,
  type LeonClientInterfaceAnswerPayload
} from '@/core/leon-interface/types'
import { getLLMModelCatalogProviders } from '@/core/llm-manager/llm-model-catalog'
import { LLMProviders } from '@/core/llm-manager/types'
import { RoutingMode, type AgentResponseTrace } from '@/types'

const CONNECTION_TIMEOUT = 120_000
const INFERENCE_TIMEOUT = 10 * 60 * 1_000
const OCR_TEXT = 'LEON AI 42'
const OCR_PATH = fileURLToPath(new URL('./fixtures/ocr.png', import.meta.url))
const SCENARIOS = [
  {
    name: 'weather',
    input: 'What is the weather like in Shenzhen?',
    functionName: 'weather.openmeteo.getCurrentConditions'
  },
  {
    name: 'ocr',
    input: `Read the text in this image using OCR: ${OCR_PATH}`,
    functionName: 'operating_system_control.file.readImage'
  }
] as const

interface Scenario {
  name: 'weather' | 'ocr'
  input: string
  functionName: string
}

/**
 * OCR may return each detected word as a separate line.
 */
function normalizeOcrText(text: string): string {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).join(' ')
}

/**
 * Check actual tool evidence so an apology or invented answer cannot pass CI.
 */
export function verifyInference(scenario: Scenario, payload: LeonClientInterfaceAnswerPayload): void {
  assert(typeof payload === 'object' && payload !== null, 'Missing agent answer')
  assert(typeof payload['answer'] === 'string' && payload['answer'].trim(), 'Empty answer')
  const trace = payload['agentResponseTrace'] as AgentResponseTrace | undefined
  const calls = trace?.toolCalls || []
  assert(!calls.some((call) => call.status !== 'success'), 'An agent tool call failed or did not finish')
  const call = calls.find((item) => item.name === scenario.functionName)
  assert(call, `Missing tool call: ${scenario.functionName}`)
  // The bridge wraps the SDK method's return value in result.
  const envelope = call.output as { result?: { success?: boolean, data?: Record<string, unknown> } } | undefined
  const output = envelope?.result
  assert.equal(output?.success, true, 'Tool reported failure')
  if (scenario.name === 'ocr') {
    assert.equal(normalizeOcrText(String(output?.data?.['text'])), OCR_TEXT, 'Incorrect OCR extraction')
    assert(normalizeOcrText(payload['answer']).includes(OCR_TEXT), 'Answer did not include the extracted text')
  } else {
    assert(String(output?.data?.['location']).toLowerCase().includes('shenzhen'), 'Wrong weather location')
    const temperature = output?.data?.['temperatureC']
    assert(typeof temperature === 'string' && temperature.trim() && Number.isFinite(Number(temperature)), 'Missing weather temperature')
  }
}

function runInference(socket: Socket, scenario: Scenario): Promise<void> {
  return new Promise((resolve, reject) => {
    let hasFinalAnswer = false
    const finish = (error?: Error): void => {
      clearTimeout(timeout)
      socket.off(EVENTS.isTyping, onTyping)
      socket.off(EVENTS.answer, onAnswer)
      socket.off(EVENTS.error, onError)
      socket.off('disconnect', onDisconnect)
      if (error) reject(error)
      else resolve()
    }
    // Wait for the answer queue to drain before sending the next owner turn.
    const onTyping = (typing: boolean): void => {
      if (!typing && hasFinalAnswer) finish()
    }
    const onError = (error: { message: string }): void => finish(new Error(error.message))
    const onDisconnect = (): void => finish(new Error('Leon disconnected during inference'))
    const onAnswer = (payload: LeonClientInterfaceAnswerPayload): void => {
      // Progress messages and widgets are not the final agent answer.
      if (typeof payload !== 'object' || !payload['agentResponseTrace']) return
      console.log(`[fresh-install:${scenario.name}] ${JSON.stringify(payload)}`)
      try {
        verifyInference(scenario, payload)
        hasFinalAnswer = true
      } catch (error) {
        finish(error as Error)
      }
    }
    const timeout = setTimeout(() => finish(new Error(`${scenario.name} inference timed out`)), INFERENCE_TIMEOUT)
    socket.on(EVENTS.isTyping, onTyping)
    socket.on(EVENTS.answer, onAnswer)
    socket.on(EVENTS.error, onError)
    socket.on('disconnect', onDisconnect)
    socket.emit(EVENTS.utterance, {
      value: scenario.input,
      commandContext: { forcedRoutingMode: RoutingMode.Agent }
    })
  })
}

async function main(): Promise<void> {
  const config = parse(fs.readFileSync(PROFILE_CONFIG_PATH, 'utf8'))
  const target = config.llm.agent || config.llm.default
  assert(target?.startsWith(`${LLMProviders.DeepSeek}/`), 'Installer did not configure DeepSeek')
  const secret = readStoredProfileToken(LEON_PROFILE_NAME)
  assert(secret, 'Installer did not create a profile token')
  const url = new URL(config.server.host)
  url.port = String(config.server.port)
  const socket = io(url.toString(), { autoConnect: false, reconnection: false })
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Leon client readiness timed out')), CONNECTION_TIMEOUT)
      const finish = (error?: Error): void => {
        clearTimeout(timeout)
        socket.off(EVENTS.ready, onReady)
        socket.off(EVENTS.error, onError)
        socket.off('connect_error', onError)
        socket.off('disconnect', onDisconnect)
        if (error) reject(error)
        else resolve()
      }
      const onReady = (): void => finish()
      const onError = (error: { message: string }): void => finish(new Error(error.message))
      const onDisconnect = (): void => finish(new Error('Leon disconnected before readiness'))
      socket.once('connect', () => socket.emit(EVENTS.init, {
        protocolVersion: LEON_CLIENT_INTERFACE_PROTOCOL_VERSION,
        client: { id: 'fresh-install', name: 'Fresh installation CI' },
        token: `${LEON_PROFILE_NAME}${PROFILE_TOKEN_SEPARATOR}${secret}`,
        capabilities: { supportsWidgets: false, supportsTokenStreaming: false, supportsVoice: false }
      }))
      socket.on(EVENTS.ready, onReady)
      socket.on(EVENTS.error, onError)
      socket.on('connect_error', onError)
      socket.on('disconnect', onDisconnect)
      socket.connect()
    })
    for (const scenario of SCENARIOS) await runInference(socket, scenario)
    console.log('Weather and OCR inference checks passed.')
  } finally {
    socket.disconnect()
  }
}

// Dependencies exist by the time the installer presents its provider prompt.
// Read its catalog instead of relying on a fixed menu position.
if (process.argv[2] === 'provider-selection') {
  const index = getLLMModelCatalogProviders().indexOf(LLMProviders.DeepSeek)
  assert(index >= 0, 'DeepSeek is missing from the setup catalog')
  process.stdout.write('\x1b[B'.repeat(index) + '\r')
} else if (process.argv[2] === 'run') {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
