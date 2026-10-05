import { afterEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

import { ToolExecutionManager, ToolExecutionState, TOOL_EXECUTION_MANAGER } from '@/core/tool-manager/tool-execution-manager'
import type { ToolExecutionResult } from '@/core/tool-manager/tool-executor'
import { toolExecutionsPlugin } from '@/core/http-server/api/tool-executions'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'

const manager = new ToolExecutionManager()
const result: ToolExecutionResult = {
  status: 'success', message: 'Done', data: {
    tool_id: 'fixture', toolkit_id: 'test', function_name: 'run',
    input: null, parsed_input: null, output: { result: { files: ['a', 'b'], truncated: true, reason: 'recordLimit' } }
  }
}

afterEach(async () => {
  await manager.dispose()
  await TOOL_EXECUTION_MANAGER.dispose()
})

it('retains one execution across wait windows, progress and completed reads', async () => {
  let finish: (value: ToolExecutionResult) => void = () => {}
  const gate = new Promise<ToolExecutionResult>((resolve) => {
    finish = resolve
  })
  const execute = vi.fn(async (_signal, progress) => {
    progress({ source: 'log', message: 'Scanning' })
    return gate
  })
  const id = manager.start('a', 'one', 'test.fixture.run', execute)
  expect((await manager.wait('a', 'one', id, 0)).execution).toMatchObject({
    id, state: ToolExecutionState.Running, progress: { message: 'Scanning' }
  })
  await manager.wait('a', 'one', id, 0)
  expect(() => manager.read('b', 'one', id)).toThrow('not found')
  expect(() => manager.read('a', 'two', id)).toThrow('not found')
  finish(result)
  expect(await manager.wait('a', 'one', id)).toMatchObject({
    execution: { id, state: ToolExecutionState.Completed }, result
  })
  expect(manager.read('a', 'one', id).result).toBe(result)
  expect(execute).toHaveBeenCalledTimes(1)
})

it('cancels the original execution and propagates owner cancellation', async () => {
  for (const ownerCancellation of [false, true]) {
    const controller = new AbortController()
    const execute = vi.fn(async (signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve()
        } else {
          signal.addEventListener('abort', () => resolve(), { once: true })
        }
      })
      return result
    })
    const id = manager.start('a', 'one', 'test.fixture.run', execute, controller.signal)
    await manager.wait('a', 'one', id, 0)
    if (ownerCancellation) {
      controller.abort()
    } else {
      await manager.cancel('a', 'one', id)
    }
    expect((await manager.wait('a', 'one', id)).execution.state).toBe(ToolExecutionState.Canceled)
    expect(execute).toHaveBeenCalledTimes(1)
  }
})

it('retains failures instead of reissuing calls', async () => {
  const id = manager.start('a', 'one', 'test.fixture.run', async () => {
    throw new Error('scan failed')
  })
  expect((await manager.wait('a', 'one', id)).execution).toMatchObject({
    state: ToolExecutionState.Failed, error: 'Error: scan failed'
  })
})

it('queries the entire retained JSON before bounding or paging its HTTP preview', async () => {
  const server = Fastify()
  await server.register(toolExecutionsPlugin, { apiVersion: 'test' })
  const profile = getActiveProfileName()
  const id = TOOL_EXECUTION_MANAGER.start(profile, 'one', 'test.fixture.run', async () => result)
  await TOOL_EXECUTION_MANAGER.wait(profile, 'one', id)

  try {
    const read = await server.inject({
      method: 'POST', url: '/api/test/tool-executions/read',
      payload: { executionId: id, sessionId: 'one', options: { maxChars: 1 } }
    })
    expect(read.statusCode).toBe(200)
    expect(read.json()).toMatchObject({ content: '{', truncated: true, nextOffsetChars: 1 })

    const count = await server.inject({
      method: 'POST', url: '/api/test/tool-executions/read',
      payload: {
        executionId: id, sessionId: 'one',
        options: { jq: '.result.files | length', maxChars: 1 }
      }
    })
    expect(count.statusCode).toBe(200)
    expect(count.json()).toMatchObject({
      content: '2', truncated: false,
      sourceCoverage: { truncated: true, reason: 'recordLimit' }
    })

    const page = await server.inject({
      method: 'POST', url: '/api/test/tool-executions/read',
      payload: { executionId: id, sessionId: 'one', options: { offsetChars: 1, maxChars: 7 } }
    })
    expect(page.json()).toMatchObject({ content: '"result', nextOffsetChars: 8 })
    const foreign = await server.inject({
      method: 'POST', url: '/api/test/tool-executions/read',
      payload: { executionId: id, sessionId: 'another-session' }
    })
    expect(foreign.statusCode).not.toBe(200)
    expect(foreign.body).not.toContain('files')
  } finally {
    await server.close()
  }
})
