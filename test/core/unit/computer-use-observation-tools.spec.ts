import fs from 'node:fs'
import path from 'node:path'
import * as timers from 'node:timers/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CuaRuntime } from '@@/tools/computer_use/cua/src/nodejs/lib/cua-runtime'
import type { ComputerUseDriver } from '@@/tools/computer_use/cua/src/nodejs/lib/types'
import type { ToolExecutionContext, ToolRuntimeResult } from '@sdk/tool-runtime-types'

vi.mock('node:timers/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:timers/promises')>()
  return { ...actual, setTimeout: vi.fn(actual.setTimeout) }
})

const PROFILE_NAME = 'computer-use-test'
const WINDOW = { pid: 42, window_id: 7 }
const DESKTOP = { kind: 'desktop', display_id: 'primary' }
const ARTIFACT_DIRECTORIES = new Set<string>()
const PROVIDERS: CuaRuntime[] = []

interface ObservationToolsHarness {
  driver: ComputerUseDriver & { callTool: ReturnType<typeof vi.fn> }
  execute: (
    action: string,
    parameters: Record<string, unknown>,
    session?: string
  ) => Promise<ToolRuntimeResult>
  zoom: () => Promise<ToolRuntimeResult>
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
  const provider = new CuaRuntime(async () => driver)
  PROVIDERS.push(provider)
  const sessionId = `observation-tools-${crypto.randomUUID()}`
  const execute = async (
    functionName: string,
    parameters: Record<string, unknown>,
    conversationSessionId = sessionId
  ): Promise<ToolRuntimeResult> => {
    const input: ToolExecutionContext = {
      toolkitId: 'computer_use', toolId: 'cua', functionName, parameters,
      profileName: PROFILE_NAME, conversationSessionId
    }
    const result = await provider.execute(input)
    for (const artifact of (result.output['artifacts'] || []) as Array<{ path: string }>) {
      ARTIFACT_DIRECTORIES.add(path.dirname(artifact.path))
    }
    return result
  }
  const zoom = (): Promise<ToolRuntimeResult> =>
    execute('zoom', { ...WINDOW, x1: 300, y1: 20, x2: 600, y2: 150 })
  return { driver, execute, zoom }
}

afterEach(async () => {
  await Promise.all(PROVIDERS.splice(0).map((provider) => provider.dispose()))
  await Promise.all([...ARTIFACT_DIRECTORIES].map((directory) => fs.promises.rm(directory, { recursive: true, force: true })))
  ARTIFACT_DIRECTORIES.clear()
})

describe('computer-use observations and capture recovery', () => {
  it('reports invalid window screenshots as failures and preserves their diagnostics', async () => {
    const { driver, execute } = createProvider()
    await execute('get_window_state', WINDOW)
    const screenshotError = {
      code: 'surface_identity_unproven',
      reason: 'No compositor-attested geometry for this window.',
      suggestion: 'Refresh list_windows and use the current control-backend ID.'
    }
    driver.callTool.mockResolvedValue({
      text: '', isError: false, images: [{ dataBase64: 'aW1hZ2U=', mimeType: 'image/png' }],
      structuredJson: JSON.stringify({
        ...WINDOW, screenshot_frame_valid: false, screenshot_error: screenshotError,
        screenshot_width: 800, screenshot_height: 200,
        elements: [{ role: 'frame', label: 'Spotify' }]
      })
    })
    const observation = await execute('get_window_state', WINDOW)
    expect(observation.success).toBe(false)
    expect(observation.message).toBe(screenshotError.reason)
    expect(observation.output).toMatchObject({ result: { screenshot_error: screenshotError } })
    expect(observation.modelFiles || []).toHaveLength(0)
    driver.callTool.mockClear()
    const click = await execute('click', { ...WINDOW, x: 540, y: 66 })
    expect(click.success).toBe(false)
    expect(click.message).toContain('refresh list_windows')
    expect(driver.callTool).not.toHaveBeenCalled()
  })

  it('waits after delivery and captures a delayed dialog without repeating the action', async () => {
    const { driver, execute } = createProvider()
    const nativeCall = driver.callTool.getMockImplementation()!
    let deliveredAt = 0
    driver.callTool.mockImplementation(async (action: string, args: string) => {
      if (action === 'press_key') deliveredAt = performance.now()
      if (action === 'get_window_state') {
        expect(performance.now() - deliveredAt).toBeGreaterThanOrEqual(25)
        return { images: [], text: 'Dialog covers the source', isError: true,
          structuredJson: JSON.stringify({ code: 'window_capture_occluded' }) }
      }
      return nativeCall(action, args)
    })
    const result = await execute('press_key', { ...WINDOW, key: 'return', settle_ms: 30 })
    expect(result.success).toBe(true)
    expect(driver.callTool.mock.calls.map(([action]) => action))
      .toEqual(['press_key', 'get_window_state', 'get_desktop_state'])
    expect(driver.callTool.mock.calls[0]![1]).not.toContain('settle_ms')
    expect(result.output).toMatchObject({ post_action_state: { capture_target: { kind: 'desktop' } } })
    expect(result.modelFiles).toHaveLength(1)
  })

  it('returns desktop evidence when a delayed window refresh finds an occluding dialog', async () => {
    const { driver, execute } = createProvider()
    const nativeCall = driver.callTool.getMockImplementation()!
    driver.callTool.mockImplementation(async (action: string, args: string) => {
      if (action === 'get_window_state') return { images: [], text: 'Covered', isError: true,
        structuredJson: JSON.stringify({ code: 'window_capture_occluded' }) }
      return nativeCall(action, args)
    })
    const started = performance.now()
    const result = await execute('get_window_state', { ...WINDOW, settle_ms: 30 })
    expect(performance.now() - started).toBeGreaterThanOrEqual(25)
    expect(result.output).toMatchObject({ post_action_state: { capture_target: { kind: 'desktop' } } })
    expect(result.modelFiles).toHaveLength(1)
    expect(driver.callTool.mock.calls.map(([action]) => action)).toEqual(['get_window_state', 'get_desktop_state'])
    expect(driver.callTool.mock.calls[0]![1]).not.toContain('settle_ms')
  })

  it.each([
    { capture_after: false, settle_ms: 30 },
    { settle_ms: -1 },
    { settle_ms: 0.5 },
    { settle_ms: '2500' }
  ])('rejects unsupported settlement options %j before delivering input', async (options) => {
    const { driver, execute } = createProvider()
    const result = await execute('press_key', { ...WINDOW, key: 'return', ...options })
    expect(result.success).toBe(false)
    expect(driver.callTool).not.toHaveBeenCalled()
  })

  it('caps oversized settle waits and delivers input only once', async () => {
    // The runtime uses promise timers, which global fake timers do not advance.
    const settleDelay = vi.mocked(timers.setTimeout).mockResolvedValueOnce(undefined)
    try {
      const { driver, execute } = createProvider()
      const result = await execute('press_key', { ...WINDOW, key: 'return', settle_ms: 2_500 })
      expect(result.success).toBe(true)
      expect(settleDelay).toHaveBeenCalledExactlyOnceWith(2_000)
      expect(driver.callTool.mock.calls.map(([action]) => action)).toEqual(['press_key', 'get_window_state'])
      expect(driver.callTool.mock.calls[0]![1]).not.toContain('settle_ms')
    } finally {
      settleDelay.mockReset()
    }
  })

  it('nests flattened verify_state selectors without losing predicates', async () => {
    const { driver, execute } = createProvider()
    const result = await execute('verify_state', { ...WINDOW,
      expect: [{ element: { role: 'frame', label_contains: 'Player', exists: true, selected: false } }]
    })
    expect(result.success).toBe(true)
    expect(JSON.parse(driver.callTool.mock.calls[0]![1])).toMatchObject({
      expect: [{ element: { selector: { role: 'frame', label_contains: 'Player' }, exists: true, selected: false } }]
    })
    driver.callTool.mockClear()
    expect((await execute('verify_state', { ...WINDOW,
      expect: [{ element: { role: 'frame', selector: { role: 'button' }, exists: true } }]
    })).success).toBe(false)
    expect(driver.callTool).not.toHaveBeenCalled()
  })

  it.each([
    ['type_text', { text: 'Icarus Tony Ann' }],
    ['hotkey', { keys: ['ctrl', 'k'] }],
    ['hotkey', { keys: ['ctrl', 'k'], pid: 0 }],
    ['hotkey', { keys: ['ctrl', 'k'], target: {} }],
    ['hotkey', { keys: ['ctrl', 'k'], target: { kind: 'window', pid: 0, window_id: 7 } }],
    ['press_key', { key: 'return' }]
  ])('never dispatches untargeted %s to pid zero', async (action, parameters) => {
    const { driver, execute } = createProvider()
    expect((await execute(action as string, parameters as Record<string, unknown>)).success).toBe(false)
    expect(driver.callTool).not.toHaveBeenCalled()
  })

  it('marks repeated pixels as a suspected no-op while preserving delivered input and visual evidence', async () => {
    const { driver, execute } = createProvider()
    await execute('get_window_state', WINDOW)
    driver.callTool.mockClear()
    const result = await execute('click', { ...WINDOW, x: 30, y: 40 })
    expect(result).toMatchObject({
      success: true,
      output: {
        result: { effect: 'suspected_noop' },
        visual_change: { status: 'unchanged', comparison: 'exact_capture' }
      }
    })
    expect(result.modelFiles).toHaveLength(1)
    expect(driver.callTool.mock.calls.map(([action]) => action)).toEqual(['click', 'get_window_state'])
    expect(driver.callTool.mock.calls[0]![1]).not.toContain('capture_after')
  })

  it('observes the actual desktop after input is refused by a modal without replaying input', async () => {
    const { driver, execute } = createProvider()
    const nativeCall = driver.callTool.getMockImplementation()!
    driver.callTool.mockImplementation(async (action: string, args: string) => {
      if (action === 'hotkey') return {
        images: [], text: 'foreground_unavailable', isError: true,
        structuredJson: JSON.stringify({ content: [{ text: 'foreground_unavailable' }], isError: true })
      }
      return nativeCall(action, args)
    })
    const result = await execute('hotkey', { ...WINDOW, keys: ['ctrl', 'w'] })
    expect(result.success).toBe(false)
    expect(driver.callTool.mock.calls.map(([action]) => action)).toEqual(['hotkey', 'get_desktop_state'])
    expect(result.output).toMatchObject({ post_action_state: { capture_target: { kind: 'desktop' } } })
    expect(result.modelFiles).toHaveLength(1)
    expect((await execute('click', { target: DESKTOP, x: 20, y: 20 })).success).toBe(true)
  })

  it('observes the destination after successful input closes its source window', async () => {
    const { driver, execute } = createProvider()
    const nativeCall = driver.callTool.getMockImplementation()!
    driver.callTool.mockImplementation(async (action: string, args: string) => {
      if (action === 'get_window_state') throw new Error('Window no longer exists')
      return nativeCall(action, args)
    })
    const result = await execute('press_key', { ...WINDOW, key: 'return' })
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ post_action_state: {
      capture_target: { kind: 'desktop' },
      previous_target_error: { success: false, error_code: 'capture_failed' }
    } })
    expect(result.output).not.toHaveProperty('post_action_state.previous_target_error.recovery')
    expect(result.modelFiles).toHaveLength(1)
    expect(driver.callTool.mock.calls.map(([action]) => action))
      .toEqual(['press_key', 'get_window_state', 'get_desktop_state'])
    expect((await execute('click', { ...WINDOW, x: 30, y: 40 })).success).toBe(false)
    expect((await execute('click', { target: DESKTOP, x: 30, y: 40 })).success).toBe(true)
  })

  it.each([
    { label: 'missing image', frameValid: undefined, images: [] },
    { label: 'invalid frame', frameValid: false, images: [{ dataBase64: 'aW1hZ2U=', mimeType: 'image/png' }] }
  ])('rejects post-action evidence with $label', async ({ frameValid, images }) => {
    const { driver, execute } = createProvider()
    await execute('get_window_state', WINDOW)
    driver.callTool.mockClear()
    const nativeCall = driver.callTool.getMockImplementation()!
    driver.callTool.mockImplementation(async (action: string, args: string) => {
      if (action === 'get_window_state') return {
        images, text: '', isError: false,
        structuredJson: JSON.stringify({
          ...WINDOW, screenshot_frame_valid: frameValid,
          elements: [{ role: 'button', label: 'Save', element_token: 'stale-save' }]
        })
      }
      return nativeCall(action, args)
    })
    const result = await execute('press_key', { ...WINDOW, key: 'return' })
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ post_action_state: {
      capture_target: { kind: 'desktop' },
      previous_target_error: { success: false, error_code: 'capture_failed' }
    } })
    expect(JSON.stringify(result.output)).not.toContain('stale-save')
    expect(result.modelFiles).toHaveLength(1)
    expect(driver.callTool.mock.calls.map(([action]) => action))
      .toEqual(['press_key', 'get_window_state', 'get_desktop_state'])
    expect(JSON.parse(driver.callTool.mock.calls[1]![1])).toMatchObject({ include_screenshot: true })
    expect((await execute('click', { ...WINDOW, x: 30, y: 40 })).success).toBe(false)
  })

  it('preserves delivered input when post-action capture fails and invalidates its pixels', async () => {
    const { driver, execute } = createProvider()
    await execute('get_window_state', WINDOW)
    driver.callTool.mockImplementation(async (action: string) => ({
      text: 'Window covered.', images: [], isError: action === 'get_window_state' || action === 'get_desktop_state',
      ...(action === 'get_window_state' ? { errorCode: 'window_capture_occluded' } : {}),
      structuredJson: JSON.stringify(action === 'get_window_state'
        ? { code: 'window_capture_occluded' } : { effect: 'unverifiable' })
    }))
    const result = await execute('click', { ...WINDOW, x: 30, y: 40, capture_after: true })
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      post_action_state: { success: false, error_code: 'window_capture_occluded' },
      recovery: expect.stringContaining('bring_to_front'),
      next_step: expect.stringContaining('do not replay input')
    })
    expect((await execute('click', { ...WINDOW, x: 30, y: 40 })).success).toBe(false)
    expect(driver.callTool).toHaveBeenCalledTimes(4)
  })

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
    expect(driver.callTool).toHaveBeenCalledWith('click', JSON.stringify({ ...WINDOW, x: 210, y: 140, from_zoom: true }))
  })

  it('directs uncertain window coordinates to zoom before acting', async () => {
    const { driver, execute } = createProvider()
    driver.callTool.mockResolvedValueOnce({
      text: '', isError: false, degraded: false, rawJson: '{}',
      images: [{ dataBase64: 'aW1hZ2U=', mimeType: 'image/png' }],
      structuredJson: JSON.stringify({
        screenshot_width: 800, screenshot_height: 200,
        window_bounds: { x: 0, y: 0, width: 800, height: 200 },
        elements: [{ role: 'frame', label: 'Application', element_token: 'frame' }]
      })
    })
    const result = await execute('get_window_state', WINDOW)
    expect(result.output['result']).toMatchObject({
      coordinate_space: 'attached_model_image',
      grounding_hint: expect.stringContaining('call zoom'),
      coordinate_hint: expect.stringContaining('only this attached image')
    })
    expect(driver.callTool).toHaveBeenCalledTimes(1)
  })

  it('rejects crop pixels on another target or outside the crop before delivery', async () => {
    const { driver, execute, zoom } = createProvider()
    await execute('get_window_state', WINDOW)
    await zoom()
    for (const parameters of [
      { ...WINDOW, window_id: 8, x: 20, y: 20 },
      { ...WINDOW, pid: 43, x: 20, y: 20 },
      { ...WINDOW, x: 500, y: 20 },
      { ...WINDOW, x: 20, y: 280 }
    ]) expect((await execute('click', parameters)).success).toBe(false)
    expect(driver.callTool).toHaveBeenCalledTimes(2)
    expect((await execute('click', { ...WINDOW, x: 210, y: 140 })).success).toBe(true)
  })

  it('focuses crop-targeted typing through a translated click, not a second translation', async () => {
    const { driver, execute, zoom } = createProvider()
    await execute('get_window_state', WINDOW)
    await zoom()
    await execute('type_text', { ...WINDOW, x: 210, y: 140, text: 'Value' })
    expect(driver.callTool).toHaveBeenNthCalledWith(3, 'click', JSON.stringify({ ...WINDOW, x: 210, y: 140, from_zoom: true }))
    expect(driver.callTool).toHaveBeenCalledWith('type_text', JSON.stringify({ ...WINDOW, text: 'Value' }))
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
    expect(driver.callTool).toHaveBeenCalledWith('click', JSON.stringify({ ...WINDOW, x: 20, y: 20 }))
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
