import fs from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ComputerUseToolProvider } from '@/core/computer-use/computer-use-tool-provider'
import type { ComputerUseDriver } from '@/core/computer-use/types'
import type { ToolProviderExecutionInput, ToolProviderExecutionResult } from '@/core/tool-provider/types'

const PROFILE_NAME = 'computer-use-test'
const WINDOW = { pid: 42, window_id: 7 }
const DESKTOP = { kind: 'desktop', display_id: 'primary' }
const ARTIFACT_DIRECTORIES = new Set<string>()
const PROVIDERS: ComputerUseToolProvider[] = []

interface ObservationToolsHarness {
  driver: ComputerUseDriver & { callTool: ReturnType<typeof vi.fn> }
  execute: (
    action: string,
    parameters: Record<string, unknown>,
    session?: string
  ) => Promise<ToolProviderExecutionResult>
  zoom: () => Promise<ToolProviderExecutionResult>
}

function createProvider(): ObservationToolsHarness {
  const driver: ObservationToolsHarness['driver'] = {
    isAvailable: () => true,
    listToolsJson: async () => JSON.stringify({ tools: [
      { name: 'click', inputSchema: { properties: { from_zoom: {} } } },
      { name: 'drag', inputSchema: { properties: { from_zoom: {} } } }
    ] }),
    callTool: vi.fn(async (action: string) => {
      const capture = ['get_window_state', 'get_desktop_state', 'zoom'].includes(action)
      return {
        text: '', isError: false, degraded: false, rawJson: '{}',
        images: capture ? [{ dataBase64: 'aW1hZ2U=', mimeType: 'image/png' }] : [],
        structuredJson: JSON.stringify(action === 'zoom'
          ? { width: 420, height: 280 }
          : capture ? { screenshot_width: 800, screenshot_height: 200 }
            : action === 'health_report'
              ? { overall: 'degraded', checks: [{ name: 'ax_capability', status: 'fail', hint: 'Enable accessibility.' }] }
              : { effect: 'unverifiable' })
      }
    }),
    shutdown: async () => undefined,
    uniffiDestroy: () => undefined
  }
  const provider = new ComputerUseToolProvider(async () => driver)
  PROVIDERS.push(provider)
  const sessionId = `observation-tools-${crypto.randomUUID()}`
  const execute = async (
    functionName: string,
    parameters: Record<string, unknown>,
    conversationSessionId = sessionId
  ): Promise<ToolProviderExecutionResult> => {
    const input: ToolProviderExecutionInput = {
      toolkitId: 'computer_use', toolId: 'cua', functionName, parameters,
      profileName: PROFILE_NAME, conversationSessionId
    }
    const result = await provider.execute(input)
    for (const artifact of (result.output['artifacts'] || []) as Array<{ path: string }>) {
      ARTIFACT_DIRECTORIES.add(path.dirname(artifact.path))
    }
    return result
  }
  const zoom = (): Promise<ToolProviderExecutionResult> =>
    execute('zoom', { ...WINDOW, x1: 300, y1: 20, x2: 600, y2: 150 })
  return { driver, execute, zoom }
}

afterEach(async () => {
  await Promise.all(PROVIDERS.splice(0).map((provider) => provider.dispose()))
  await Promise.all([...ARTIFACT_DIRECTORIES].map((directory) => fs.promises.rm(directory, { recursive: true, force: true })))
  ARTIFACT_DIRECTORIES.clear()
})

describe('computer-use diagnostic, hover, and zoom tools', () => {
  it('returns actionable health checks without taking screenshots', async () => {
    const { driver, execute } = createProvider()
    const result = await execute('health_report', { include: ['ax_capability'] })
    expect(result.success).toBe(true)
    expect(result.output['result']).toMatchObject({ overall: 'degraded', checks: [
      { name: 'ax_capability', status: 'fail', hint: 'Enable accessibility.' }
    ] })
    expect(driver.callTool.mock.calls.map(([action]) => action)).toEqual(['health_report'])
    expect(result.modelFiles).toBeUndefined()
  })

  it('grounds real desktop hover and captures its result by default', async () => {
    const { driver, execute } = createProvider()
    expect((await execute('move_cursor', { target: DESKTOP, x: 400, y: 100 })).success).toBe(false)
    expect((await execute('move_cursor', { x: 400, y: 100 })).success).toBe(false)
    expect(driver.callTool).not.toHaveBeenCalled()
    await execute('get_desktop_state', {})
    const result = await execute('move_cursor', { target: DESKTOP, x: 400, y: 100 })
    expect(result.success).toBe(true)
    expect(result.output).toHaveProperty('post_action_state')
    expect(driver.callTool).toHaveBeenCalledWith('move_cursor', JSON.stringify({ target: DESKTOP, x: 400, y: 100 }))
    expect(driver.callTool.mock.calls.map(([action]) => action)).toEqual([
      'get_desktop_state', 'move_cursor', 'get_desktop_state'
    ])
  })

  it('uses window-image axes for zoom selection and native crop mapping for clicks', async () => {
    const { driver, execute, zoom } = createProvider()
    expect((await zoom()).success).toBe(false)
    await execute('get_window_state', WINDOW)
    const result = await zoom()
    expect(result.success).toBe(true)
    expect(result.output['result']).toMatchObject({ screenshot_width: 420, screenshot_height: 280, zoomed: true })
    expect(driver.callTool).toHaveBeenCalledWith('zoom', JSON.stringify({ ...WINDOW, x1: 300, y1: 20, x2: 600, y2: 150 }))
    await execute('click', { ...WINDOW, x: 210, y: 140 })
    expect(driver.callTool).toHaveBeenLastCalledWith('click', JSON.stringify({ ...WINDOW, x: 210, y: 140, from_zoom: true }))
  })

  it('focuses crop-targeted typing through a translated click, not a second translation', async () => {
    const { driver, execute, zoom } = createProvider()
    await execute('get_window_state', WINDOW)
    await zoom()
    await execute('type_text', { ...WINDOW, x: 210, y: 140, text: 'Value' })
    expect(driver.callTool).toHaveBeenNthCalledWith(3, 'click', JSON.stringify({ ...WINDOW, x: 210, y: 140, from_zoom: true }))
    expect(driver.callTool).toHaveBeenLastCalledWith('type_text', JSON.stringify({ ...WINDOW, text: 'Value' }))
  })

  it('requires full-window grounding for unsupported crop input and nested zoom', async () => {
    const { driver, execute, zoom } = createProvider()
    await execute('get_window_state', WINDOW)
    await zoom()
    expect((await execute('scroll', { ...WINDOW, x: 20, y: 20, direction: 'down' })).success).toBe(false)
    expect((await zoom()).success).toBe(false)
    expect(driver.callTool).toHaveBeenCalledTimes(2)
    await execute('get_window_state', WINDOW)
    expect((await execute('click', { ...WINDOW, x: 20, y: 20 })).success).toBe(true)
    expect(driver.callTool).toHaveBeenLastCalledWith('click', JSON.stringify({ ...WINDOW, x: 20, y: 20 }))
  })

  it('invalidates an older conversation crop when a different conversation zooms', async () => {
    const { execute, zoom, driver } = createProvider()
    const otherSession = crypto.randomUUID()
    await execute('get_window_state', WINDOW)
    await zoom()
    await execute('get_window_state', WINDOW, otherSession)
    await execute('zoom', { ...WINDOW, x1: 50, y1: 30, x2: 350, y2: 150 }, otherSession)
    expect((await execute('click', { ...WINDOW, x: 20, y: 20 })).success).toBe(false)
    expect(driver.callTool).toHaveBeenCalledTimes(4)
  })

  it('rejects invalid crop rectangles before calling the driver', async () => {
    const { execute, driver } = createProvider()
    await execute('get_window_state', WINDOW)
    for (const region of [
      { x1: 20, y1: 20, x2: 10, y2: 30 },
      { x1: 20, y1: 20, x2: 20, y2: 30 },
      { x1: -1, y1: 20, x2: 40, y2: 30 },
      { x1: 20, y1: 20, x2: 900, y2: 30 }
    ]) expect((await execute('zoom', { ...WINDOW, ...region })).success).toBe(false)
    expect(driver.callTool).toHaveBeenCalledTimes(1)
  })
})
