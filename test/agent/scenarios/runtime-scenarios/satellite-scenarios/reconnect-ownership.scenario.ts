import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import type { SatelliteToolInvocation } from '@/core/satellite/types'
import type { SatelliteTransport } from '@/core/satellite/satellite-registry'

const scenario: RealAgentScenario = {
  async run() {
    const { SATELLITE_REGISTRY } = await import('@/core/satellite/satellite-registry')
    const { SATELLITE_EVENTS } = await import('@/core/satellite/types')
    const { getActiveProfileName } = await import('@/core/profile-runtime/profile-context')
    const profileName = getActiveProfileName()
    const device = { id: 'scenario-device', name: 'Isolated device transport', platform: process.platform }
    let calls = 0
    const stale: SatelliteTransport = { emit(): void {} }
    const current: SatelliteTransport = {
      emit(event, payload): void {
        if (event !== SATELLITE_EVENTS.invokeTool) {
          return
        }
        calls += 1
        const invocation = payload as SatelliteToolInvocation
        queueMicrotask(() => SATELLITE_REGISTRY.handleResult(profileName, device.id, {
          invocationId: invocation.invocationId,
          result: {
            status: 'success', message: 'Device observation.',
            data: { tool_id: 'openmeteo', toolkit_id: 'weather', function_name: 'getWeather',
              input: null, parsed_input: null, output: { result: { temperature: 18 } } }
          }
        }, current))
      }
    }
    SATELLITE_REGISTRY.register({ profileName, device, transport: stale, toolkits: [] })
    SATELLITE_REGISTRY.register({ profileName, device, transport: current, toolkits: [] })
    try {
      assert.equal(SATELLITE_REGISTRY.unregister(profileName, device.id, stale), false)
      assert.equal(SATELLITE_REGISTRY.getConnection(`${profileName}-other`, device.id), null)
      const input = { profileName, deviceId: device.id,
        conversationSessionId: 'owned-session',
        toolInput: { toolkitId: 'weather', toolId: 'openmeteo', functionName: 'getWeather', parsedInput: { location: 'Oslo' } } }
      const result = await SATELLITE_REGISTRY.invokeTool(input)
      assert.equal(result.status, 'success')
      assert.equal(calls, 1)
      SATELLITE_REGISTRY.unregister(profileName, device.id, current)
      await assert.rejects(SATELLITE_REGISTRY.invokeTool(input), /offline/)
      assert.equal(calls, 1, 'Offline calls must not replay through another transport.')

      return { calls, result, externalFixture: 'In-process device transport; no owner desktop is accessed.' }
    } finally {
      SATELLITE_REGISTRY.unregister(profileName, device.id)
    }
  }
}

export default scenario
