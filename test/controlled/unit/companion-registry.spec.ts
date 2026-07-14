import { afterEach, describe, expect, it, vi } from 'vitest'

import { COMPANION_REGISTRY } from '@/core/companion/companion-registry'
import { COMPANION_EVENTS } from '@/core/companion/types'
import type { CompanionToolInvocation } from '@/core/companion/types'
import type { ToolExecutionResult } from '@/core/tool-executor'

const PROFILE_NAME = 'companion-test-profile'
const DEVICE_ID = 'companion-test-device'
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

describe('CompanionRegistry', () => {
  afterEach(() => {
    COMPANION_REGISTRY.unregister(PROFILE_NAME, DEVICE_ID)
  })

  it('routes a tool call to the registered profile device', async () => {
    const emit = vi.fn()

    COMPANION_REGISTRY.register({
      profileName: PROFILE_NAME,
      device: {
        id: DEVICE_ID,
        name: 'Test Companion',
        platform: 'linux'
      },
      toolkits: [],
      transport: { emit }
    })

    const executionPromise = COMPANION_REGISTRY.invokeTool({
      profileName: PROFILE_NAME,
      deviceId: DEVICE_ID,
      toolInput: TOOL_INPUT
    })
    const invocation = emit.mock.calls[0]?.[1] as CompanionToolInvocation

    expect(emit).toHaveBeenCalledWith(
      COMPANION_EVENTS.invokeTool,
      expect.objectContaining({ input: TOOL_INPUT })
    )

    COMPANION_REGISTRY.handleResult(PROFILE_NAME, DEVICE_ID, {
      invocationId: invocation.invocationId,
      result: TOOL_RESULT
    })

    await expect(executionPromise).resolves.toEqual(TOOL_RESULT)
  })

  it('rejects pending work when the device disconnects', async () => {
    COMPANION_REGISTRY.register({
      profileName: PROFILE_NAME,
      device: {
        id: DEVICE_ID,
        name: 'Test Companion',
        platform: 'linux'
      },
      toolkits: [],
      transport: { emit: vi.fn() }
    })

    const executionPromise = COMPANION_REGISTRY.invokeTool({
      profileName: PROFILE_NAME,
      deviceId: DEVICE_ID,
      toolInput: TOOL_INPUT
    })

    COMPANION_REGISTRY.unregister(PROFILE_NAME, DEVICE_ID)

    await expect(executionPromise).rejects.toThrow(
      `Companion "${DEVICE_ID}" disconnected.`
    )
  })
})
