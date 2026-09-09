import execa from 'execa'
import ffmpegStatic from 'ffmpeg-static'

import { COMPUTER_USE_COORDINATE_FIELDS, COMPUTER_USE_SCREEN_CAPTURE_ACTIONS, CUA_WINDOW_CAPTURE_OCCLUDED_ERROR_CODE } from '../constants'
import type { ComputerUseDriver, CuaToolResult } from '../types'
import { asRecord, hasCuaError, parseJsonRecord } from '../utils'

const DISPLAY_SERVICE = 'org.gnome.Mutter.DisplayConfig'
const DISPLAY_PATH = '/org/gnome/Mutter/DisplayConfig'
const COMMAND_TIMEOUT_MS = 5_000
const IMAGE_BUFFER_LIMIT = 32 * 1_024 * 1_024
const LOGICAL_LAYOUT_MODE = 1
const PNG_HEADER = Buffer.from('89504e470d0a1a0a', 'hex')
// Matches Cua 0.25's native zoom registry; its input translation owns this padding.
const ZOOM_PADDING = 0.2

interface Rectangle { x: number, y: number, width: number, height: number }
export interface GnomeCaptureLayout {
  width: number
  height: number
  serial: number
}

/** Reads logical stage dimensions from Mutter's typed D-Bus response. */
export function parseGnomeCaptureLayout(response: unknown): GnomeCaptureLayout {
  const data = asRecord(response)?.['data'] as unknown[] | undefined
  const monitors = data?.[1] as unknown[][] | undefined
  const logicalMonitors = data?.[2] as unknown[][] | undefined
  const properties = asRecord(data?.[3])
  if (!monitors?.length || !logicalMonitors?.length ||
      asRecord(properties?.['layout-mode'])?.['data'] !== LOGICAL_LAYOUT_MODE) {
    throw new Error('Cannot establish GNOME logical display coordinates.')
  }
  let width = 0
  let height = 0
  for (const logical of logicalMonitors) {
    const [x, y, scale, rotation, , outputs] = logical as [number, number, number, number, boolean, string[][]]
    const monitor = monitors.find((entry) => JSON.stringify(entry[0]) === JSON.stringify(outputs?.[0]))
    const modes = monitor?.[1] as unknown[][] | undefined
    const mode = modes?.find((entry) => asRecord(asRecord(entry.at(-1))?.['is-current'])?.['data'] === true)
    const physicalWidth = Number(mode?.[1])
    const physicalHeight = Number(mode?.[2])
    if (![x, y, scale, physicalWidth, physicalHeight, rotation].every(Number.isFinite) ||
        x < 0 || y < 0 || scale <= 0 || physicalWidth <= 0 || physicalHeight <= 0) {
      throw new Error('GNOME returned invalid display geometry.')
    }
    // Odd Mutter transforms rotate the output through 90 or 270 degrees.
    width = Math.max(width, x + Math.round((rotation % 2 ? physicalHeight : physicalWidth) / scale))
    height = Math.max(height, y + Math.round((rotation % 2 ? physicalWidth : physicalHeight) / scale))
  }
  return { width, height, serial: Number(data?.[0]) }
}

async function readLayout(): Promise<GnomeCaptureLayout> {
  const result = await execa('busctl', [
    '--user', '--json=short', 'call', DISPLAY_SERVICE, DISPLAY_PATH,
    DISPLAY_SERVICE, 'GetCurrentState'
  ], { timeout: COMMAND_TIMEOUT_MS })
  return parseGnomeCaptureLayout(JSON.parse(result.stdout))
}

/** Normalizes the compositor stage before cropping, so pixels match input points. */
export async function normalizeGnomeCapture(
  image: Buffer,
  layout: GnomeCaptureLayout,
  crop?: Rectangle,
  output?: { width: number, height: number }
): Promise<Buffer> {
  if (image.length < 24 || !image.subarray(0, PNG_HEADER.length).equals(PNG_HEADER)) {
    throw new Error('GNOME capture is not a PNG image.')
  }
  const width = image.readUInt32BE(16)
  const height = image.readUInt32BE(20)
  // A non-uniform stage cannot be safely interpreted as one coordinate plane.
  if (Math.abs(width / layout.width - height / layout.height) > 1 / Math.min(layout.width, layout.height)) {
    throw new Error('GNOME capture does not match the current display layout. Observe again.')
  }
  if (crop && (!Object.values(crop).every(Number.isFinite) || crop.x < 0 || crop.y < 0 ||
      crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > layout.width || crop.y + crop.height > layout.height)) {
    throw new Error('The window is partly outside the captured desktop. Move it fully on screen and observe again.')
  }
  if (width === layout.width && height === layout.height && !crop && !output) return image
  if (!ffmpegStatic) throw new Error('FFmpeg is required to normalize GNOME capture coordinates.')
  const filters = [
    `scale=${layout.width}:${layout.height}:flags=lanczos`,
    ...(crop ? [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`] : []),
    ...(output ? [`scale=${output.width}:${output.height}:flags=lanczos`] : [])
  ]
  const result = await execa(ffmpegStatic, [
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vf', filters.join(','),
    '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'
  ], { input: image, encoding: null, maxBuffer: IMAGE_BUFFER_LIMIT, timeout: COMMAND_TIMEOUT_MS })
  return result.stdout
}

/** Corrects Cua's GNOME stage crops without changing native input or consent. */
export class CuaWaylandCaptureAdapter implements ComputerUseDriver {
  public readonly setAgentCursorEnabled?: NonNullable<ComputerUseDriver['setAgentCursorEnabled']>
  private readonly observedLayouts = new Map<string, GnomeCaptureLayout>()

  public constructor(
    private readonly driver: ComputerUseDriver,
    private readonly getLayout = readLayout
  ) {
    if (driver.setAgentCursorEnabled) {
      this.setAgentCursorEnabled = driver.setAgentCursorEnabled.bind(driver)
    }
  }

  public isAvailable(): boolean { return this.driver.isAvailable() }
  public listToolsJson(): Promise<string> { return this.driver.listToolsJson() }
  public shutdown(): Promise<void> {
    this.observedLayouts.clear()
    return this.driver.shutdown()
  }
  public uniffiDestroy(): void { this.driver.uniffiDestroy() }

  public async callTool(name: string, argumentsJson: string): Promise<CuaToolResult> {
    const args = parseJsonRecord(argumentsJson) || {}
    const session = String(args['session'] || '')
    if (!COMPUTER_USE_SCREEN_CAPTURE_ACTIONS.has(name)) {
      const previous = this.observedLayouts.get(session)
      const hasPixels = COMPUTER_USE_COORDINATE_FIELDS[name]?.some((key) => typeof args[key] === 'number')
      if (previous && hasPixels && JSON.stringify(await this.getLayout()) !== JSON.stringify(previous)) {
        throw new Error('The display layout changed since the last screenshot. Observe again before input.')
      }
      if (name === 'end_session') this.observedLayouts.delete(session)
      return this.driver.callTool(name, argumentsJson)
    }
    const layout = await this.getLayout()
    const result = await this.driver.callTool(name, argumentsJson)
    if (hasCuaError(result) || !result.images.length) return result
    const state = parseJsonRecord(result.structuredJson)
    if (!state) throw new Error('Cua capture has no coordinate metadata.')
    const desktop = name !== 'get_desktop_state'
      ? await this.driver.callTool('get_desktop_state', JSON.stringify({ session: args['session'] }))
      : result
    if (hasCuaError(desktop)) return desktop
    let crop: Rectangle | undefined
    if (name !== 'get_desktop_state') {
      const windowsResult = await this.driver.callTool('list_windows', JSON.stringify({ session: args['session'] }))
      if (hasCuaError(windowsResult)) return windowsResult
      const windows = parseJsonRecord(windowsResult.structuredJson)?.['windows'] as Record<string, unknown>[] | undefined
      const window = windows?.find((entry) => entry['window_id'] === args['window_id'] && entry['pid'] === args['pid'])
      const bounds = asRecord(window?.['bounds'])
      if (!bounds || window?.['is_on_screen'] !== true ||
          (name === 'get_window_state' && ['x', 'y', 'width', 'height'].some(
            (key) => asRecord(state['window_bounds'])?.[key] !== bounds[key]
          ))) {
        throw new Error('The window moved or became unavailable during capture. Observe it again.')
      }
      crop = { x: Number(bounds['x']), y: Number(bounds['y']), width: Number(bounds['width']), height: Number(bounds['height']) }
      // WinRects reports bottom-to-top stacking. Desktop crops contain the
      // covering app's pixels, even when the requested window is on screen.
      const overlapping = windows?.filter((entry) => {
        if (entry === window || entry['is_on_screen'] !== true) return false
        const other = asRecord(entry['bounds'])
        if (!other) return true
        const overlaps = Number(other['x']) < crop!.x + crop!.width &&
          Number(other['x']) + Number(other['width']) > crop!.x &&
          Number(other['y']) < crop!.y + crop!.height &&
          Number(other['y']) + Number(other['height']) > crop!.y
        return overlaps && (typeof entry['z_index'] !== 'number' ||
          typeof window?.['z_index'] !== 'number' || entry['z_index'] > window['z_index'])
      }) || []
      if (overlapping.length) {
        const failure = {
          code: CUA_WINDOW_CAPTURE_OCCLUDED_ERROR_CODE,
          detail: 'Another window covers this GNOME desktop crop. It cannot be presented as an image of the requested window.',
          pid: args['pid'], window_id: args['window_id'],
          covering_windows: overlapping.map((entry) => ({
            pid: entry['pid'], window_id: entry['window_id'], title: entry['title']
          }))
        }
        return {
          ...result, images: [], isError: true, errorCode: failure.code,
          text: failure.detail, structuredJson: JSON.stringify(failure), rawJson: JSON.stringify(failure)
        }
      }
      if (name === 'zoom') {
        const x1 = Number(args['x1']), y1 = Number(args['y1'])
        const x2 = Number(args['x2']), y2 = Number(args['y2'])
        const paddingX = Math.max(x2 - x1, 1) * ZOOM_PADDING
        const paddingY = Math.max(y2 - y1, 1) * ZOOM_PADDING
        const left = Math.min(Math.floor(Math.max(x1 - paddingX, 0)), crop.width)
        const top = Math.min(Math.floor(Math.max(y1 - paddingY, 0)), crop.height)
        crop = {
          x: crop.x + left, y: crop.y + top,
          width: Math.max(Math.floor(Math.min(x2 + paddingX, crop.width)) - left, 1),
          height: Math.max(Math.floor(Math.min(y2 + paddingY, crop.height)) - top, 1)
        }
      }
    }
    // Keep Cua's returned window dimensions: its native resize/zoom registry
    // translates those pixels back to logical window points on the next input.
    const output = crop ? {
      width: Number(state[name === 'zoom' ? 'width' : 'screenshot_width']),
      height: Number(state[name === 'zoom' ? 'height' : 'screenshot_height'])
    } : undefined
    const image = desktop.images.at(-1)
    if (!image) throw new Error('Cua returned no desktop image for the window capture.')
    const current = await this.getLayout()
    if (JSON.stringify(current) !== JSON.stringify(layout)) {
      throw new Error('The display layout changed during capture. Observe again.')
    }
    const png = await normalizeGnomeCapture(Buffer.from(image.dataBase64, 'base64'), layout, crop, output)
    this.observedLayouts.set(session, current)
    const corrected = {
      ...state,
      ...(crop ? {} : {
        screen_width: layout.width, screen_height: layout.height,
        screenshot_width: layout.width, screenshot_height: layout.height, scale_factor: 1
      }),
      ...(name === 'zoom' ? { format: 'png', mime_type: 'image/png' } : { screenshot_mime_type: 'image/png' })
    }
    return {
      ...result, text: '',
      images: [{ dataBase64: png.toString('base64'), mimeType: 'image/png' }],
      structuredJson: JSON.stringify(corrected), rawJson: JSON.stringify(corrected)
    }
  }
}
