import { afterEach, describe, expect, it, vi } from 'vitest'

import { SATELLITE_REGISTRY } from '@/core/satellite/satellite-registry'
import { SATELLITE_EVENTS } from '@/core/satellite/types'
import type { SatelliteToolInvocation } from '@/core/satellite/types'
import type { ToolExecutionResult } from '@/core/tool-executor'

const PROFILE_NAME = 'satellite-test-profile'
const DEVICE_ID = 'satellite-test-device'
const TOOL_INPUT = {
  toolkitId: 'system',
  toolId: 'file-system',
  functionName: 'list'
}
const TOOL_RESULT: ToolExecutionResult = {
  status: 'success',
  message: 'Tool executed successfully.',
  data: {
    tool_id: TOOL_INPUT.toolId,
    toolkit_id: TOOL_INPUT.toolkitId,
    function_name: TOOL_INPUT.functionName,
    input: null,
    parsed_input: null,
    output: { entries: ['Desktop'] }
  }
}

describe('SatelliteRegistry', () => {
  afterEach(() => {
    SATELLITE_REGISTRY.unregister(PROFILE_NAME, DEVICE_ID)
  })

  it('routes a tool call to the registered profile device', async () => {
    const emit = vi.fn()

    SATELLITE_REGISTRY.register({
      profileName: PROFILE_NAME,
      device: {
        id: DEVICE_ID,
        name: 'Test Satellite',
        platform: 'linux'
      },
      toolkits: [],
      transport: { emit }
    })

    const executionPromise = SATELLITE_REGISTRY.invokeTool({
      profileName: PROFILE_NAME,
      deviceId: DEVICE_ID,
      toolInput: TOOL_INPUT
    })
    const invocation = emit.mock.calls[0]?.[1] as SatelliteToolInvocation

    expect(emit).toHaveBeenCalledWith(
      SATELLITE_EVENTS.invokeTool,
      expect.objectContaining({ input: TOOL_INPUT })
    )

    SATELLITE_REGISTRY.handleResult(PROFILE_NAME, DEVICE_ID, {
      invocationId: invocation.invocationId,
      result: TOOL_RESULT
    })

    await expect(executionPromise).resolves.toEqual(TOOL_RESULT)
  })

  it('rejects pending work when the device disconnects', async () => {
    SATELLITE_REGISTRY.register({
      profileName: PROFILE_NAME,
      device: {
        id: DEVICE_ID,
        name: 'Test Satellite',
        platform: 'linux'
      },
      toolkits: [],
      transport: { emit: vi.fn() }
    })

    const executionPromise = SATELLITE_REGISTRY.invokeTool({
      profileName: PROFILE_NAME,
      deviceId: DEVICE_ID,
      toolInput: TOOL_INPUT
    })

    SATELLITE_REGISTRY.unregister(PROFILE_NAME, DEVICE_ID)

    await expect(executionPromise).rejects.toThrow(
      `Satellite "${DEVICE_ID}" disconnected.`
    )
  })

  it('keeps a replacement connection when the old transport disconnects', async () => {
    const oldTransport = { emit: vi.fn() }
    const replacementEmit = vi.fn()

    SATELLITE_REGISTRY.register({
      profileName: PROFILE_NAME,
      device: {
        id: DEVICE_ID,
        name: 'Old Satellite',
        platform: 'linux'
      },
      toolkits: [],
      transport: oldTransport
    })
    SATELLITE_REGISTRY.register({
      profileName: PROFILE_NAME,
      device: {
        id: DEVICE_ID,
        name: 'Replacement Satellite',
        platform: 'linux'
      },
      toolkits: [],
      transport: { emit: replacementEmit }
    })

    expect(
      SATELLITE_REGISTRY.unregister(
        PROFILE_NAME,
        DEVICE_ID,
        oldTransport
      )
    ).toBe(false)

    const executionPromise = SATELLITE_REGISTRY.invokeTool({
      profileName: PROFILE_NAME,
      deviceId: DEVICE_ID,
      toolInput: TOOL_INPUT
    })
    const invocation = replacementEmit.mock.calls[0]?.[1] as SatelliteToolInvocation

    SATELLITE_REGISTRY.handleResult(PROFILE_NAME, DEVICE_ID, {
      invocationId: invocation.invocationId,
      result: TOOL_RESULT
    })

    expect(oldTransport.emit).not.toHaveBeenCalled()
    await expect(executionPromise).resolves.toEqual(TOOL_RESULT)
  })
})
