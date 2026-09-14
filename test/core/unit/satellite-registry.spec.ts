import { afterEach, describe, expect, it, vi } from 'vitest'

import { SATELLITE_REGISTRY } from '@/core/satellite/satellite-registry'
import { SATELLITE_EVENTS } from '@/core/satellite/types'
import * as artifactTransfer from '@/core/satellite/satellite-artifacts'
import type { SatelliteToolInvocation } from '@/core/satellite/types'
import { SATELLITE_CONTEXT_MAX_AGE_MS } from '@/core/satellite/satellite-context'
import type { ToolExecutionResult } from '@/core/tool-executor'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'

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
  it('isolates discovery snapshots by owner, transport and lifetime and rejects arbitrary files', () => {
    vi.useFakeTimers()
    const transport = { emit: vi.fn() }
    SATELLITE_REGISTRY.register({
      profileName: PROFILE_NAME, device: { id: DEVICE_ID, name: 'Test', platform: 'linux' },
      toolkits: [], transport
    })
    const payload = { files: { 'ACTIVITY.md': '> Device apps' } }
    SATELLITE_REGISTRY.updateContext('other-owner', DEVICE_ID, payload, transport)
    SATELLITE_REGISTRY.updateContext(PROFILE_NAME, DEVICE_ID, payload, { emit: vi.fn() })
    expect(SATELLITE_REGISTRY.getContext(PROFILE_NAME, DEVICE_ID)).toBeNull()
    for (const files of [{ '../OWNER.md': 'private' }, { 'ACTIVITY.md': 'x'.repeat(32_001) }, { 'ACTIVITY.md': 42 }]) {
      SATELLITE_REGISTRY.updateContext(PROFILE_NAME, DEVICE_ID, { files }, transport)
      expect(SATELLITE_REGISTRY.getContext(PROFILE_NAME, DEVICE_ID)).toBeNull()
    }
    SATELLITE_REGISTRY.updateContext(PROFILE_NAME, DEVICE_ID, payload, transport)
    expect(SATELLITE_REGISTRY.getContext(PROFILE_NAME, DEVICE_ID)).toEqual(payload)
    expect(SATELLITE_REGISTRY.getContext('other-owner', DEVICE_ID)).toBeNull()
    vi.advanceTimersByTime(SATELLITE_CONTEXT_MAX_AGE_MS)
    expect(SATELLITE_REGISTRY.getContext(PROFILE_NAME, DEVICE_ID)).toBeNull()
    SATELLITE_REGISTRY.updateContext(PROFILE_NAME, DEVICE_ID, payload, transport)
    SATELLITE_REGISTRY.unregister(PROFILE_NAME, DEVICE_ID)
    expect(SATELLITE_REGISTRY.getContext(PROFILE_NAME, DEVICE_ID)).toBeNull()
  })

  afterEach(() => {
    SATELLITE_REGISTRY.unregister(PROFILE_NAME, DEVICE_ID)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('imports artifacts only for the authenticated invocation and preserves cancellation during import', async () => {
    const destination = vi.spyOn(artifactTransfer, 'getSatelliteArtifactRoot').mockReturnValue('/server/session/artifacts')
    let finishImport!: (result: ToolExecutionResult) => void
    const receive = vi.spyOn(artifactTransfer, 'receiveSatelliteArtifacts').mockImplementation(() =>
      new Promise((resolve) => { finishImport = resolve }))
    const transport = { emit: vi.fn() }
    SATELLITE_REGISTRY.register({
      profileName: PROFILE_NAME, device: { id: DEVICE_ID, name: 'Test', platform: 'linux' },
      toolkits: [], transport
    })
    const controller = new AbortController()
    const execution = SATELLITE_REGISTRY.invokeTool({
      profileName: PROFILE_NAME, deviceId: DEVICE_ID, conversationSessionId: 'session',
      toolInput: TOOL_INPUT, signal: controller.signal
    })
    const invocation = transport.emit.mock.calls[0]?.[1] as SatelliteToolInvocation
    const payload = { invocationId: invocation.invocationId, result: TOOL_RESULT, artifacts: { root: '/device/artifacts', entries: [] } }
    SATELLITE_REGISTRY.handleResult('another-owner', DEVICE_ID, payload, transport)
    SATELLITE_REGISTRY.handleResult(PROFILE_NAME, DEVICE_ID, payload, { emit: vi.fn() })
    expect(receive).not.toHaveBeenCalled()
    SATELLITE_REGISTRY.handleResult(PROFILE_NAME, DEVICE_ID, payload, transport)
    expect(destination).toHaveBeenCalledWith(PROFILE_NAME, 'session')
    expect(receive).toHaveBeenCalledWith('/server/session/artifacts', TOOL_RESULT, payload.artifacts)
    const rejection = expect(execution).rejects.toThrow('canceled')
    controller.abort()
    finishImport(TOOL_RESULT)
    await rejection
  })

  it.each(['abort', 'timeout', 'disconnect'] as const)('cancels device work on %s and ignores late results', async (cause) => {
    vi.useFakeTimers()
    const transport = { emit: vi.fn() }
    const controller = new AbortController()
    SATELLITE_REGISTRY.register({
      profileName: PROFILE_NAME,
      device: { id: DEVICE_ID, name: 'Test', platform: 'linux' },
      toolkits: [], transport
    })
    const execution = SATELLITE_REGISTRY.invokeTool({
      profileName: PROFILE_NAME, deviceId: DEVICE_ID,
      toolInput: TOOL_INPUT, signal: controller.signal
    })
    const rejection = expect(execution).rejects.toThrow()
    const invocation = transport.emit.mock.calls[0]?.[1] as SatelliteToolInvocation
    if (cause === 'abort') controller.abort()
    else if (cause === 'timeout') await vi.advanceTimersByTimeAsync(15 * 60 * 1_000)
    else SATELLITE_REGISTRY.unregister(PROFILE_NAME, DEVICE_ID)

    expect(transport.emit).toHaveBeenCalledWith(SATELLITE_EVENTS.cancelTool, { invocationId: invocation.invocationId })
    SATELLITE_REGISTRY.handleResult(PROFILE_NAME, DEVICE_ID, { invocationId: invocation.invocationId, result: TOOL_RESULT }, transport)
    await rejection
  })

  it('does not dispatch aborted work or accept another owner or transport result', async () => {
    const transport = { emit: vi.fn() }
    SATELLITE_REGISTRY.register({
      profileName: PROFILE_NAME,
      device: { id: DEVICE_ID, name: 'Test', platform: 'linux' },
      toolkits: [], transport
    })
    await expect(SATELLITE_REGISTRY.invokeTool({
      profileName: PROFILE_NAME, deviceId: DEVICE_ID, toolInput: TOOL_INPUT,
      signal: AbortSignal.abort()
    })).rejects.toThrow()
    expect(transport.emit).not.toHaveBeenCalled()
    const execution = SATELLITE_REGISTRY.invokeTool({
      profileName: PROFILE_NAME, deviceId: DEVICE_ID, toolInput: TOOL_INPUT
    })
    const invocation = transport.emit.mock.calls[0]?.[1] as SatelliteToolInvocation
    const payload = { invocationId: invocation.invocationId, result: TOOL_RESULT }
    const resolved = vi.fn()
    void execution.then(resolved)
    SATELLITE_REGISTRY.handleResult('different-owner', DEVICE_ID, payload, transport)
    SATELLITE_REGISTRY.handleResult(PROFILE_NAME, DEVICE_ID, payload, { emit: vi.fn() })
    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()
    SATELLITE_REGISTRY.handleResult(PROFILE_NAME, DEVICE_ID, payload, transport)
    await expect(execution).resolves.toEqual(TOOL_RESULT)
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

  it('restores the invocation profile for progress callbacks', async () => {
    const emit = vi.fn()
    const observedProfiles: string[] = []

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
      toolInput: TOOL_INPUT,
      onProgress: () => {
        observedProfiles.push(getActiveProfileName())
      }
    })
    const invocation = emit.mock.calls[0]?.[1] as SatelliteToolInvocation

    runWithProfileContext({ profileName: 'unrelated-profile' }, () => {
      SATELLITE_REGISTRY.handleProgress(PROFILE_NAME, DEVICE_ID, {
        invocationId: invocation.invocationId,
        progress: {
          source: 'log',
          message: 'Codex started working.'
        }
      })
    })
    SATELLITE_REGISTRY.handleResult(PROFILE_NAME, DEVICE_ID, {
      invocationId: invocation.invocationId,
      result: TOOL_RESULT
    })

    expect(observedProfiles).toEqual([PROFILE_NAME])
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
