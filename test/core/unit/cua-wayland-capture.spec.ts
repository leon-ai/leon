import execa from 'execa'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  CuaWaylandCaptureAdapter,
  normalizeGnomeCapture,
  parseGnomeCaptureLayout
} from '@/core/computer-use/cua/cua-wayland-capture'
import type { ComputerUseDriver, CuaToolResult } from '@/core/computer-use/types'

const LAYOUT = { width: 600, height: 450, serial: 1 }
const BOUNDS = { x: 300, y: 150, width: 150, height: 150 }
let desktop: Buffer

beforeAll(async () => {
  // The green window is at physical (400,200), logical (300,150).
  const result = await execa(ffmpegStatic!, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=red:s=800x600,drawbox=x=400:y=200:w=200:h=200:color=lime:t=fill',
    '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'
  ], { encoding: null })
  desktop = result.stdout
})

async function centerPixel(image: Buffer): Promise<number[]> {
  const { stdout } = await execa(ffmpegStatic!, [
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
    '-vf', 'crop=1:1:iw/2:ih/2:exact=1', '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ], { input: image, encoding: null })
  return [...stdout]
}

function result(state: Record<string, unknown>, image?: Buffer): CuaToolResult {
  return {
    text: '', isError: false, degraded: false,
    rawJson: JSON.stringify(state), structuredJson: JSON.stringify(state),
    images: image ? [{ dataBase64: image.toString('base64'), mimeType: 'image/png' }] : []
  }
}

function driver(windowBounds = BOUNDS, otherWindows: Record<string, unknown>[] = []): ComputerUseDriver {
  return {
    isAvailable: () => true, shutdown: async (): Promise<void> => {}, uniffiDestroy: (): void => {},
    listToolsJson: async () => '{}',
    callTool: vi.fn(async (name: string) => {
      if (name === 'get_desktop_state') return result({ screenshot_width: 800, screenshot_height: 600 }, desktop)
      if (name === 'list_windows') return result({ windows: [
        { pid: 10, window_id: 20, bounds: windowBounds, is_on_screen: true, z_index: 10 }, ...otherWindows
      ] })
      if (name === 'zoom') return result({ width: 140, height: 140 }, desktop)
      return result({ window_bounds: BOUNDS, screenshot_width: 75, screenshot_height: 75 }, desktop)
    })
  }
}

describe('GNOME coordinate normalization', () => {
  it('crops the actual window at fractional scale and preserves native resize dimensions', async () => {
    const adapter = new CuaWaylandCaptureAdapter(driver(), async () => LAYOUT)
    const capture = await adapter.callTool('get_window_state', JSON.stringify({ pid: 10, window_id: 20, session: 'test' }))
    const png = Buffer.from(capture.images[0]!.dataBase64, 'base64')
    expect(png.readUInt32BE(16)).toBe(75)
    expect(png.readUInt32BE(20)).toBe(75)
    const [red, green, blue] = await centerPixel(png)
    expect(green).toBeGreaterThan(240)
    expect(red).toBeLessThan(10)
    expect(blue).toBeLessThan(10)
  })

  it('returns desktop pixels in the same logical frame as input', async () => {
    const adapter = new CuaWaylandCaptureAdapter(driver(), async () => LAYOUT)
    const capture = await adapter.callTool('get_desktop_state', '{}')
    expect(JSON.parse(capture.structuredJson!)).toMatchObject({
      screenshot_width: 600, screenshot_height: 450, screen_width: 600, screen_height: 450
    })
    const png = Buffer.from(capture.images[0]!.dataBase64, 'base64')
    expect(png.readUInt32BE(16)).toBe(600)
    expect(png.readUInt32BE(20)).toBe(450)
  })

  it('does not reinterpret input coordinates or browser consent calls', async () => {
    const native = driver()
    const read = vi.fn(async () => LAYOUT)
    const adapter = new CuaWaylandCaptureAdapter(native, read)
    for (const name of ['click', 'browser_prepare', 'get_browser_state']) {
      const args = JSON.stringify({ x: 350, y: 200, session: 'test' })
      await adapter.callTool(name, args)
      expect(native.callTool).toHaveBeenLastCalledWith(name, args)
    }
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects a window that moved between observation and the corrected capture', async () => {
    const adapter = new CuaWaylandCaptureAdapter(driver({ ...BOUNDS, x: 310 }), async () => LAYOUT)
    await expect(adapter.callTool('get_window_state', '{"pid":10,"window_id":20}')).rejects.toThrow('window moved')
  })

  it.each([20, null])('rejects overlapping windows with higher or unknown stacking (%s)', async (zIndex) => {
    const native = driver(BOUNDS, [{ pid: 30, window_id: 40, bounds: BOUNDS, is_on_screen: true, z_index: zIndex }])
    const adapter = new CuaWaylandCaptureAdapter(native, async () => LAYOUT)
    const capture = await adapter.callTool('get_window_state', '{"pid":10,"window_id":20}')
    expect(capture.isError).toBe(true)
    expect(capture.errorCode).toBe('window_capture_occluded')
    expect(capture.images).toEqual([])
  })

  it('allows windows behind the target, outside its bounds, or on another workspace', async () => {
    const native = driver(BOUNDS, [
      { bounds: BOUNDS, is_on_screen: true, z_index: 5 },
      { bounds: { ...BOUNDS, x: 0 }, is_on_screen: true, z_index: 20 },
      { bounds: BOUNDS, is_on_screen: false, z_index: 30 }
    ])
    const adapter = new CuaWaylandCaptureAdapter(native, async () => LAYOUT)
    expect((await adapter.callTool('get_window_state', '{"pid":10,"window_id":20}')).isError).toBe(false)
  })

  it('rejects a display change during capture', async () => {
    const read = vi.fn().mockResolvedValueOnce(LAYOUT).mockResolvedValue({ ...LAYOUT, serial: 2 })
    const adapter = new CuaWaylandCaptureAdapter(driver(), read)
    await expect(adapter.callTool('get_desktop_state', '{}')).rejects.toThrow('layout changed')
  })

  it('does not dispatch input against a superseded display layout', async () => {
    const native = driver()
    const read = vi.fn().mockResolvedValue(LAYOUT)
    const adapter = new CuaWaylandCaptureAdapter(native, read)
    await adapter.callTool('get_desktop_state', '{"session":"test"}')
    read.mockResolvedValue({ ...LAYOUT, serial: 2 })
    await expect(adapter.callTool('click', '{"session":"test","x":350,"y":200}')).rejects.toThrow('before input')
    expect(native.callTool).toHaveBeenCalledTimes(1)
  })

  it('normalizes padded zoom captures without altering native zoom arguments', async () => {
    const native = driver()
    const adapter = new CuaWaylandCaptureAdapter(native, async () => LAYOUT)
    const args = '{"pid":10,"window_id":20,"x1":25,"y1":25,"x2":125,"y2":125}'
    const capture = await adapter.callTool('zoom', args)
    expect(native.callTool).toHaveBeenNthCalledWith(1, 'zoom', args)
    expect(capture.images[0]!.mimeType).toBe('image/png')
    const png = Buffer.from(capture.images[0]!.dataBase64, 'base64')
    expect(png.readUInt32BE(16)).toBe(140)
    expect((await centerPixel(png))[1]).toBeGreaterThan(240)
  })

  it('leaves an unscaled desktop unchanged', async () => {
    expect(await normalizeGnomeCapture(desktop, { width: 800, height: 600, serial: 1 })).toBe(desktop)
  })

  it('refuses incompatible geometry and partially off-screen windows', async () => {
    await expect(normalizeGnomeCapture(desktop, { ...LAYOUT, width: 500 })).rejects.toThrow('display layout')
    await expect(normalizeGnomeCapture(desktop, LAYOUT, { ...BOUNDS, x: -1 })).rejects.toThrow('outside')
  })
})

describe('Mutter display layout', () => {
  it.each([1, 1.25, 4 / 3, 1.5, 2])('derives logical dimensions at scale %s', (scale) => {
    const spec = ['DP-1', 'vendor', 'model', 'serial']
    const response = { data: [1,
      [[spec, [['mode', 2_400, 1_800, 60, 1, [scale], { 'is-current': { data: true } }]], {}]],
      [[0, 0, scale, 0, true, [spec], {}]],
      { 'layout-mode': { data: 1 } }
    ] }
    expect(parseGnomeCaptureLayout(response)).toEqual({ width: Math.round(2_400 / scale), height: Math.round(1_800 / scale), serial: 1 })
  })

  it('accounts for rotated outputs and monitor offsets', () => {
    const first = ['DP-1'], second = ['DP-2']
    const response = { data: [2,
      [first, second].map((spec) => [spec, [['mode', 1_920, 1_080, 60, 1, [1], { 'is-current': { data: true } }]], {}]),
      [[0, 0, 1, 0, true, [first], {}], [1_920, 0, 1, 1, false, [second], {}]],
      { 'layout-mode': { data: 1 } }
    ] }
    expect(parseGnomeCaptureLayout(response)).toEqual({ width: 3_000, height: 1_920, serial: 2 })
  })
})
