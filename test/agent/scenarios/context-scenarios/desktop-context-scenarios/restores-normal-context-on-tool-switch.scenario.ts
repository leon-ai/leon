import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import type { ModelCall } from '../../model-fault-fixture'
import { inScenarioWorkspace } from '../../scenario-fixture'
import type { SatelliteToolInvocation } from '@/core/satellite/types'

const CLOSED_REPORT = 'Closed desktop migration report'
const FILE_VALUE = 'handoff-note-314159'
const WINDOW = { pid: 42, window_id: 7 }
const OBSERVE = 'computer_use__cua__observe'
const READ_WINDOW = 'computer_use__cua__get_window_state'
const READ_FILE = 'file_system__file__read'
const SCREENSHOT = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALUlEQVR4nGPUCKlloCVgoqnpoxaMWjBqwagFoxaMWjBqwagFoxaMWjBqARUBAFm8ATlDAGrPAAAAAElFTkSuQmCC'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { TOOLKIT_REGISTRY, CONVERSATION_LOGGER } = await import('@/core')
      const { SATELLITE_REGISTRY } = await import('@/core/satellite/satellite-registry')
      const { runWithSelectedDevice } = await import('@/core/satellite/device-context')
      const { runWithConversationSession } = await import('@/core/session-manager/session-context')
      const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
      const { getActiveProfileName } = await import('@/core/profile-runtime/profile-context')
      const { ReActLLMDuty } = await import('@/core/llm-manager/llm-duties/react-llm-duty')
      const { CONFIG_STATE } = await import('@/core/config-states/config-state')
      const { getLLMModelCatalogEntry } = await import('@/core/llm-manager/llm-model-catalog')
      const { LogHelper } = await import('@/helpers/log-helper')
      const profile = getActiveProfileName()
      const session = CONVERSATION_SESSION_MANAGER.createSession().id
      const device = randomUUID()
      const file = path.join(workspace, 'handoff.txt')
      await writeFile(file, FILE_VALUE)
      await runWithConversationSession({ sessionId: session }, async () => {
        for (const [who, message] of [
          ['owner', 'Record that the desktop migration is closed.'],
          ['leon', CLOSED_REPORT],
          ['owner', 'The migration is complete. Move on to the studio.'],
          ['leon', 'I’m ready to inspect the studio.']
        ] as const) {
          await CONVERSATION_LOGGER.push({ who, message, isAddedToHistory: true })
        }
      })

      await TOOLKIT_REGISTRY.load()
      const manifest = TOOLKIT_REGISTRY.getPairedDeviceManifest(['computer_use.cua'])
      assert.equal(manifest.length, 1)
      const definition = manifest[0]!.tools['cua']!
      definition.functions = {
        observe: definition.functions['observe']!,
        get_window_state: definition.functions['get_window_state']!
      }

      const transport = {
        emit(_event: string, payload: unknown): void {
          const invocation = payload as SatelliteToolInvocation
          SATELLITE_REGISTRY.handleResult(profile, device, {
            invocationId: invocation.invocationId,
            result: {
              status: 'success',
              message: 'Captured the studio window.',
              data: {
                toolkit_id: 'computer_use',
                tool_id: 'cua',
                function_name: invocation.input.functionName!,
                input: invocation.input.toolInput ?? '{}',
                parsed_input: invocation.input.parsedInput ?? {},
                output: { result: {
                  ...WINDOW,
                  title: 'Studio',
                  screenshot_frame_valid: true,
                  capture_target: { kind: 'window', ...WINDOW }
                } },
                model_files: [{ dataBase64: SCREENSHOT, mediaType: 'image/png' }]
              }
            }
          }, transport)
        }
      }

      TOOLKIT_REGISTRY.registerSatelliteTools(device, manifest, true)
      SATELLITE_REGISTRY.register({
        profileName: profile, device: { id: device, name: 'Studio', platform: process.platform },
        toolkits: manifest, transport
      })
      const calls: Array<{ desktop: boolean, oldReport: boolean, tools: string[], policy?: string }> = []
      let policy: string | undefined
      const prototype = ReActLLMDuty.prototype as unknown as { callAgentModel: ModelCall }
      const original = prototype.callAgentModel
      const debug = LogHelper.debug
      prototype.callAgentModel = async function (...args: Parameters<ModelCall>): ReturnType<ModelCall> {
        const [messages, , , options] = args
        policy = undefined
        const response = await original.apply(this, args)
        if (!options.isCompletionReview) {
          calls.push({
            desktop: (options as typeof options & { isDesktopDecision?: boolean }).isDesktopDecision === true,
            oldReport: messages.some((message) => message.content === CLOSED_REPORT),
            tools: response?.toolCalls?.map((call) => call.function.name) ?? [],
            ...(policy ? { policy } : {})
          })
        }
        return response
      }
      LogHelper.debug = (message: string): void => {
        if (message.startsWith('Prompt dispatch')) {
          policy = message.match(/effort=[^ ]+ \| effort_source=[^ ]+/)?.[0]
        }
        debug.call(LogHelper, message)
      }

      try {
        const turn = await runWithSelectedDevice(device, () => context.runTurn(
          `Perform these checks in order. First use computer_use.cua.observe to inspect the Studio window. Then use file_system.file.read to read ${file}. Finally use computer_use.cua.get_window_state to recheck the window you just observed. Report the exact file contents and the window title. Do these three checks even if you already know the file path or window title.`,
          session
        ))
        assert.equal(turn.finalIntent, 'answer')
        assert.match(turn.output, new RegExp(FILE_VALUE))
        assert.match(turn.output, /Studio/)
        const toolNames = turn.executionHistory.map((execution) => execution.function)
        assert.deepEqual(toolNames.filter((name) =>
          ['computer_use.cua.observe', 'computer_use.cua.get_window_state', 'file_system.file.read'].includes(name)
        ), ['computer_use.cua.observe', 'file_system.file.read', 'computer_use.cua.get_window_state'])

        const first = calls.findIndex((call) => call.tools.includes(OBSERVE))
        const normalRead = calls.findIndex((call) => !call.desktop && call.tools.includes(READ_FILE))
        const back = calls.findIndex((call) => call.tools.includes(READ_WINDOW))
        assert.ok(first >= 0 && first < normalRead && normalRead < back)
        assert.ok(calls.slice(first + 1, normalRead).some((call) => call.desktop && !call.oldReport))
        assert.equal(calls[normalRead]?.oldReport, true)
        assert.ok(calls.slice(back + 1).some((call) => call.desktop && !call.oldReport))
        assert.equal(calls[first]?.desktop, false)
        assert.ok(calls[first]?.policy)
        assert.equal(calls[normalRead]?.policy, calls[first]?.policy)
        const target = CONFIG_STATE.getModelState().getAgentTarget()
        const levels = getLLMModelCatalogEntry(target.provider, target.model)?.reasoning ?? []
        const minimum = levels.find((level) => level !== 'auto' && level !== 'on')
        if (minimum) {
          assert.ok(calls.some((call) =>
            call.desktop && call.policy === `effort=${minimum} | effort_source=desktop`
          ))
        }

        return { calls }
      } finally {
        prototype.callAgentModel = original
        LogHelper.debug = debug
        SATELLITE_REGISTRY.unregister(profile, device)
        TOOLKIT_REGISTRY.removeSatelliteTools(device)
      }
    })
  }
}

export default scenario
