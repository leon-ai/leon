import { afterEach, describe, expect, it, vi } from 'vitest'

import { LINK_REGISTRY } from '@/core/link/link-registry'
import { LINK_EVENTS } from '@/core/link/types'
import type { LinkToolInvocation } from '@/core/link/types'
import type { ToolExecutionResult } from '@/core/tool-executor'

const PROFILE_NAME = 'link-test-profile'
const DEVICE_ID = 'link-test-device'
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

describe('LinkRegistry', () => {
  afterEach(() => {
    LINK_REGISTRY.unregister(PROFILE_NAME, DEVICE_ID)
  })

  it('routes a tool call to the registered profile device', async () => {
    const emit = vi.fn()

    LINK_REGISTRY.register({
      profileName: PROFILE_NAME,
      device: {
        id: DEVICE_ID,
        name: 'Test Link',
        platform: 'linux'
      },
      toolkits: [],
      transport: { emit }
    })

    const executionPromise = LINK_REGISTRY.invokeTool({
      profileName: PROFILE_NAME,
      deviceId: DEVICE_ID,
      toolInput: TOOL_INPUT
    })
    const invocation = emit.mock.calls[0]?.[1] as LinkToolInvocation

    expect(emit).toHaveBeenCalledWith(
      LINK_EVENTS.invokeTool,
      expect.objectContaining({ input: TOOL_INPUT })
    )

    LINK_REGISTRY.handleResult(PROFILE_NAME, DEVICE_ID, {
      invocationId: invocation.invocationId,
      result: TOOL_RESULT
    })

    await expect(executionPromise).resolves.toEqual(TOOL_RESULT)
  })

  it('rejects pending work when the device disconnects', async () => {
    LINK_REGISTRY.register({
      profileName: PROFILE_NAME,
      device: {
        id: DEVICE_ID,
        name: 'Test Link',
        platform: 'linux'
      },
      toolkits: [],
      transport: { emit: vi.fn() }
    })

    const executionPromise = LINK_REGISTRY.invokeTool({
      profileName: PROFILE_NAME,
      deviceId: DEVICE_ID,
      toolInput: TOOL_INPUT
    })

    LINK_REGISTRY.unregister(PROFILE_NAME, DEVICE_ID)

    await expect(executionPromise).rejects.toThrow(
      `Link "${DEVICE_ID}" disconnected.`
    )
  })
})
