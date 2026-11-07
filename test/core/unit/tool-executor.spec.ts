import os from 'node:os'

import { describe, expect, it, vi } from 'vitest'

import ToolExecutor, { type ToolExecutionInput, type ToolExecutionResult } from '@/core/tool-manager/tool-executor'
import ToolkitRegistry from '@/core/tool-manager/toolkit-registry'
import { TOOL_EXECUTION_MANAGER } from '@/core/tool-manager/tool-execution-manager'
import { TOOL_EXECUTION_WAIT_MS } from '@/constants'
import { runWithConversationSession } from '@/core/session-manager/session-context'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { TOOL_WORKER_MANAGER } from '@/core'
import { ToolCallLogger } from '@/tool-call-logger'
import { ToolConcurrency, ToolExecutionOrigin } from '@/types'
import { ToolRuntimePhase } from '@@/bridges/runtime/contracts/tool-runtime-types'

interface FilesystemValueNormalizer {
  normalizePossibleFilesystemPath(value: string): string
}

interface ExecutorInternals {
  executeToolInternal(input: ToolExecutionInput): Promise<ToolExecutionResult>
}

it('retains caller attribution in tool results and artifact logs', async () => {
  const executor = new ToolExecutor() as unknown as {
    buildResult(params: Record<string, unknown>): Promise<ToolExecutionResult>
  }
  const logged = vi.spyOn(ToolCallLogger.prototype, 'recordToolOutput').mockResolvedValue(null)

  for (const origin of [ToolExecutionOrigin.Agent, ToolExecutionOrigin.Persona]) {
    const output = { result: { temperature: 24 } }
    const result = await executor.buildResult({
      origin,
      status: 'success',
      message: 'Observed weather',
      input: null,
      resolvedTool: { toolkitId: 'weather', toolId: 'fixture' },
      functionName: 'read',
      output
    })

    expect(result.data.origin).toBe(origin)
    expect(result.data.output).toEqual(output)
    expect(logged).toHaveBeenLastCalledWith(expect.objectContaining({ origin, output }))
  }
})

it.each([
  { boundary: 'wait window', cancel: false, background: true },
  { boundary: 'follow-up message', cancel: false, background: true },
  { boundary: 'follow-up message', cancel: true, background: true },
  { boundary: 'follow-up message', cancel: false, background: false },
  { boundary: 'follow-up message', cancel: true, background: false }
])('retains work across $boundary (background: $background, canceled: $cancel)', async ({ boundary, cancel, background }) => {
  const executor = new ToolExecutor()
  const completed: ToolExecutionResult = {
    status: 'success', message: 'Done', data: {
      tool_id: 'fixture', toolkit_id: 'test', function_name: 'run',
      input: '{}', parsed_input: {}, output: { result: { files: ['a', 'b'] } }
    }
  }
  let finish: (value: ToolExecutionResult) => void = () => {}
  const gate = new Promise<ToolExecutionResult>((resolve) => {
    finish = resolve
  })
  const execute = vi.spyOn(executor as unknown as ExecutorInternals, 'executeToolInternal')
    .mockImplementation((input) => {
      if (!background) {
        input.onProgress?.({ source: 'report', message: 'Preparing tool assets.', phase: ToolRuntimePhase.Preparation })
      }
      input.onProgress?.({
        source: 'report', key: 'bridges.tools.download_progress_with_details',
        message: 'Downloading fixture: 40%.', data: { percentage: 40 }
      })
      return gate
    })
  vi.spyOn(ToolkitRegistry.prototype, 'getToolFunctions').mockReturnValue({
    run: { description: 'Read a fixture', parameters: {}, background }
  })
  vi.useFakeTimers()
  const turn = new AbortController()
  const followUp = new AbortController()
  const onProgress = vi.fn()

  try {
    const pending = runWithConversationSession({ sessionId: 'retained-executor' }, () =>
      executor.executeTool({
        toolkitId: 'test', toolId: 'fixture', functionName: 'run',
        toolInput: '{}', retainExecution: true,
        signal: followUp.signal, retainedSignal: turn.signal, onProgress
      })
    )
    if (boundary === 'follow-up message') {
      followUp.abort(new Error('New owner instructions require reassessment.'))
      await vi.advanceTimersByTimeAsync(0)
    } else {
      await vi.advanceTimersByTimeAsync(TOOL_EXECUTION_WAIT_MS)
    }
    const yielded = await pending
    const execution = yielded.data.output['execution'] as { id: string, state: string }
    expect(execution.state).toBe('running')
    expect(yielded.message).toContain('do not restart')
    expect(execute.mock.calls[0]![0].signal!.aborted).toBe(!background && boundary === 'follow-up message')
    expect(execute.mock.calls[0]![0].retainedSignal!.aborted).toBe(false)
    expect(execution).toMatchObject({ progress: { data: { percentage: 40 } } })
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      stream: { id: execution.id, state: 'running' }, data: { percentage: 40 }
    }))
    if (cancel) {
      turn.abort(new Error('Stopped by the owner.'))
      expect(execute.mock.calls[0]![0].retainedSignal!.aborted).toBe(true)
    }
    finish(completed)
    const retained = await TOOL_EXECUTION_MANAGER.wait(
      getActiveProfileName(), 'retained-executor', execution.id
    )
    expect(retained.execution.state).toBe(cancel ? 'canceled' : 'completed')
    expect(retained.result).toEqual(completed)
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      stream: { id: execution.id, state: cancel ? 'failed' : 'completed' }, data: completed.data.output
    }))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0].retainExecution).toBe(false)
  } finally {
    finish(completed)
    vi.useRealTimers()
    await TOOL_EXECUTION_MANAGER.dispose()
  }
})

it('keeps ordinary callers and functions without background opt-in synchronous', async () => {
  for (const background of [false, true]) {
    const executor = new ToolExecutor()
    vi.spyOn(ToolkitRegistry.prototype, 'getToolFunctions').mockReturnValue({
      run: { description: 'Read a fixture', parameters: {}, background }
    })
    vi.spyOn(executor as unknown as ExecutorInternals, 'executeToolInternal').mockResolvedValue({
      status: 'success', message: 'Done', data: {
        tool_id: 'fixture', toolkit_id: 'test', function_name: 'run',
        input: null, parsed_input: null, output: { result: 'done' }
      }
    })
    const result = await runWithConversationSession({ sessionId: 'synchronous-executor' }, () =>
      executor.executeTool({
        toolkitId: 'test', toolId: 'fixture', functionName: 'run',
        retainExecution: !background
      })
    )
    expect(result.data.output).toEqual({ result: 'done' })
  }
})

it('keeps oversized synchronous output queryable within its owning conversation', async () => {
  const executor = new ToolExecutor()
  const completed: ToolExecutionResult = {
    status: 'success', message: 'Done', data: {
      tool_id: 'fixture', toolkit_id: 'test', function_name: 'run',
      input: null, parsed_input: null,
      output: { result: { records: Array.from({ length: 10_000 }, (_, id) => ({ id })) } }
    }
  }
  const execute = vi.spyOn(executor as unknown as ExecutorInternals, 'executeToolInternal')
    .mockResolvedValue(completed)
  vi.spyOn(ToolkitRegistry.prototype, 'getToolFunctions').mockReturnValue({
    run: { description: 'Read a fixture', parameters: {} }
  })

  try {
    const result = await runWithConversationSession({ sessionId: 'retained-sync' }, () =>
      executor.executeTool({
        toolkitId: 'test', toolId: 'fixture', functionName: 'run', retainExecution: true
      })
    )
    const execution = result.data.output['execution'] as { id: string, state: string }

    expect(execution.state).toBe('completed')
    expect(TOOL_EXECUTION_MANAGER.read(
      getActiveProfileName(), 'retained-sync', execution.id
    ).result).toBe(completed)
    expect(() => TOOL_EXECUTION_MANAGER.read(
      getActiveProfileName(), 'another-session', execution.id
    )).toThrow('not found')
    expect(execute).toHaveBeenCalledTimes(1)
  } finally {
    await TOOL_EXECUTION_MANAGER.dispose()
  }
})

it('keeps a bounded retained-result page inline without creating another execution', async () => {
  const executor = new ToolExecutor()
  const content = 'x'.repeat(8_000)
  const completed: ToolExecutionResult = {
    status: 'success', message: 'Read', data: {
      tool_id: 'fixture', toolkit_id: 'test', function_name: 'read',
      input: null, parsed_input: null, output: { result: {
        execution: { id: 'original-result', state: 'completed' },
        content, value: content, truncated: false
      } }
    }
  }
  vi.spyOn(executor as unknown as ExecutorInternals, 'executeToolInternal')
    .mockResolvedValue(completed)
  vi.spyOn(ToolkitRegistry.prototype, 'getToolFunctions').mockReturnValue({
    read: { description: 'Read a retained page', parameters: {} }
  })

  const result = await runWithConversationSession({ sessionId: 'inline-page' }, () =>
    executor.executeTool({
      toolkitId: 'test', toolId: 'fixture', functionName: 'read', retainExecution: true
    })
  )

  expect(result).toBe(completed)
  expect(result.data.output).not.toHaveProperty('execution')
})

describe('ToolExecutor filesystem value normalization', () => {
  it('preserves patterns, globs and matched text through actual tool dispatch', async () => {
    const executor = new ToolExecutor()
    vi.spyOn(ToolkitRegistry.prototype, 'resolveToolById').mockReturnValue({
      toolkitId: 'test', toolId: 'fixture', toolName: 'Fixture', toolDescription: 'Fixture'
    })
    vi.spyOn(ToolkitRegistry.prototype, 'getToolConnectionProviders').mockReturnValue([])
    vi.spyOn(ToolkitRegistry.prototype, 'getToolSatelliteDevice').mockReturnValue(undefined)
    vi.spyOn(ToolkitRegistry.prototype, 'needsToolConnection').mockReturnValue(false)
    vi.spyOn(ToolkitRegistry.prototype, 'getToolAvailability').mockReturnValue({ available: true, missingSettings: [] })
    vi.spyOn(ToolkitRegistry.prototype, 'getToolFunctions').mockReturnValue({ run: {
      description: 'Search', parameters: {
        type: 'object', properties: { pattern: { type: 'string' }, glob: { type: 'string' } }
      }
    } })
    const output = { result: { lines: { text: '/api//v1' }, path: { text: './src/file.ts' } } }
    const dispatch = vi.spyOn(TOOL_WORKER_MANAGER, 'execute').mockResolvedValue({
      success: true, message: 'Done', output
    })
    const concurrency = vi.spyOn(ToolkitRegistry.prototype, 'getToolConcurrency')
      .mockReturnValue(ToolConcurrency.Serial)
    const result = await executor.executeTool({
      toolkitId: 'test', toolId: 'fixture', functionName: 'run',
      parsedInput: { pattern: '/api//v1', glob: './src/**' },
      leonService: { baseURL: 'http://localhost', token: 'test' }
    })

    expect(dispatch.mock.calls[0]?.[1]).toEqual(['/api//v1', './src/**'])
    expect(concurrency).toHaveBeenCalledWith('test', 'fixture', 'run')
    expect(dispatch.mock.calls[0]?.[3]).toEqual({ concurrency: ToolConcurrency.Serial })
    expect(result.data.output).toEqual(output)
  })

  it('does not treat a temporary runtime directory as a user-home root', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/tmp/leon-isolated-home')
    const executor = new ToolExecutor() as unknown as FilesystemValueNormalizer
    const benchmarkArtifact = '/tmp/computer-use-run/result.txt'

    expect(executor.normalizePossibleFilesystemPath(benchmarkArtifact)).toBe(
      benchmarkArtifact
    )
  })
})
