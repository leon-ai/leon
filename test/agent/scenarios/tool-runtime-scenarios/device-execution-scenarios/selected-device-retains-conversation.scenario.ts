import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import type { SatelliteToolInvocation } from '@/core/satellite/types'

const TOOLKIT = 'computer_use'
const TOOL = 'cua'
const FUNCTION = 'list_windows'

const scenario: RealAgentScenario = {
  async run(context) {
    const { TOOLKIT_REGISTRY, TOOL_EXECUTOR } = await import('@/core')
    const { SATELLITE_REGISTRY } = await import('@/core/satellite/satellite-registry')
    const { runWithSelectedDevice } = await import('@/core/satellite/device-context')
    const { getActiveProfileName } = await import('@/core/profile-runtime/profile-context')
    const { runWithConversationSession } = await import('@/core/session-manager/session-context')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const profile = getActiveProfileName()
    const session = CONVERSATION_SESSION_MANAGER.createSession().id
    const first = randomUUID()
    const second = randomUUID()
    const used: string[] = []

    await TOOLKIT_REGISTRY.load()
    const manifest = TOOLKIT_REGISTRY.getPairedDeviceManifest([TOOLKIT + '.' + TOOL])
    assert.equal(manifest.length, 1)
    const definition = manifest[0]!.tools[TOOL]!
    definition.functions = { [FUNCTION]: definition.functions[FUNCTION]! }

    for (const id of [first, second]) {
      const transport = {
        emit(_event: string, payload: unknown): void {
          const invocation = payload as SatelliteToolInvocation
          used.push(id)
          SATELLITE_REGISTRY.handleResult(profile, id, {
            invocationId: invocation.invocationId,
            result: {
              status: 'success', message: 'Read the selected device windows.',
              data: {
                toolkit_id: TOOLKIT, tool_id: TOOL, function_name: FUNCTION,
                input: '{}', parsed_input: {},
                output: { result: { windows: [{ title: 'Studio fixture window', pid: 42, window_id: 1 }] } }
              }
            }
          }, transport)
        }
      }

      TOOLKIT_REGISTRY.registerSatelliteTools(id, manifest, true)
      SATELLITE_REGISTRY.register({
        profileName: profile, device: { id, name: id, platform: process.platform },
        toolkits: manifest, transport
      })
    }

    try {
      const turn = await runWithSelectedDevice(first, () => context.runTurn(
        'Use the Cua list_windows tool to tell me the exact title of the open window on this device.',
        session
      ))
      assert.match(turn.output, /Studio fixture window/)
      assert.ok(used.length > 0 && used.every((id) => id === first))
      const sent = used.length

      SATELLITE_REGISTRY.unregister(profile, first)
      TOOLKIT_REGISTRY.removeSatelliteTools(first)
      const call = (): ReturnType<typeof TOOL_EXECUTOR.executeTool> => runWithConversationSession(
        { sessionId: session }, () => TOOL_EXECUTOR.executeTool({
          toolkitId: TOOLKIT, toolId: TOOL, functionName: FUNCTION, parsedInput: {}
        })
      )
      const offline = await runWithSelectedDevice(first, call)
      assert.match(offline.message, /offline/)
      const changed = await runWithSelectedDevice(second, call)
      assert.match(changed.message, /different device/)
      assert.equal(used.length, sent)

      return { turn, offline: offline.status, changed: changed.status }
    } finally {
      for (const id of [first, second]) {
        SATELLITE_REGISTRY.unregister(profile, id)
        TOOLKIT_REGISTRY.removeSatelliteTools(id)
      }
    }
  }
}

export default scenario
