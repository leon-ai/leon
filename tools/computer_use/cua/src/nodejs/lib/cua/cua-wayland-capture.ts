import { execa } from 'execa'

import { COMPUTER_USE_COORDINATE_FIELDS, COMPUTER_USE_SCREEN_CAPTURE_ACTIONS, CUA_WINDOW_CAPTURE_OCCLUDED_ERROR_CODE } from '../constants'
import { getFfmpegBinaryPath } from '../ffmpeg'
import type { ComputerUseDriver, CuaToolResult } from '../types'
import { asRecord, hasCuaError, parseJsonRecord } from '../utils'

const DISPLAY_SERVICE = 'org.gnome.Mutter.DisplayConfig'
const DISPLAY_PATH = '/org/gnome/Mutter/DisplayConfig'
const COMMAND_TIMEOUT_MS = 5_000
const IMAGE_BUFFER_LIMIT = 32 * 1_024 * 1_024
const LOGICAL_LAYOUT_MODE = 1
const PNG_HEADER = Buffer.from('89504e470d0a1a0a', 'hex')
// Matches Cua's zoom crop, whose origin also drives from_zoom input.
const ZOOM_PADDING = 0.2

interface Rectangle { x: number, y: number, width: number, height: number }
export interface GnomeCaptureLayout {
  width: number
  height: number
  serial: number
  unscaledSingleMonitor: boolean
}

/**
 * Reads logical stage dimensions from Mutter's typed D-Bus response.
 */
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
  const [x, y, scale, rotation, , outputs] = logicalMonitors[0]!

  return {
    width, height, serial: Number(data?.[0]),
    unscaledSingleMonitor: logicalMonitors.length === 1 && Array.isArray(outputs) && outputs.length === 1 &&
      x === 0 && y === 0 && scale === 1 && rotation === 0
  }
}

async function readLayout(): Promise<GnomeCaptureLayout> {
  const result = await execa('busctl', [
    '--user', '--json=short', 'call', DISPLAY_SERVICE, DISPLAY_PATH,
    DISPLAY_SERVICE, 'GetCurrentState'
  ], { timeout: COMMAND_TIMEOUT_MS })
  return parseGnomeCaptureLayout(JSON.parse(result.stdout))
}

function readPngDimensions(image: Buffer): Pick<Rectangle, 'width' | 'height'> {
  if (image.length < 24 || !image.subarray(0, PNG_HEADER.length).equals(PNG_HEADER)) {
    throw new Error('GNOME capture is not a PNG image.')
  }

  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
}

/**
 * Keeps desktop screenshot pixels in the compositor's input coordinate space.
 */
export async function normalizeGnomeCapture(
  image: Buffer,
  layout: GnomeCaptureLayout,
  crop?: Rectangle,
  output?: Pick<Rectangle, 'width' | 'height'>
): Promise<Buffer> {
  const { width, height } = readPngDimensions(image)

  // A non-uniform stage cannot be safely interpreted as one coordinate plane.
  if (Math.abs(width / layout.width - height / layout.height) > 1 / Math.min(layout.width, layout.height)) {
    throw new Error('GNOME capture does not match the current display layout. Observe again.')
  }
  const needsScale = width !== layout.width || height !== layout.height
  if (!needsScale && !crop && !output) {
    return image
  }

  const binary = await getFfmpegBinaryPath()
  const filters = [
    ...(needsScale ? [`scale=${layout.width}:${layout.height}:flags=lanczos`] : []),
    ...(crop ? [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`] : []),
    ...(output && (output.width !== crop?.width || output.height !== crop?.height)
      ? [`scale=${output.width}:${output.height}:flags=lanczos`] : [])
  ]
  const result = await execa(binary, [
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
    '-vf', filters.join(','),
    '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'
  ], {
    input: image,
    encoding: 'buffer',
    maxBuffer: IMAGE_BUFFER_LIMIT,
    timeout: COMMAND_TIMEOUT_MS
  })

  return Buffer.from(result.stdout)
}

function getZoomCrop(
  args: Record<string, unknown>,
  frame: Rectangle,
  scale: number
): Rectangle {
  const x1 = Number(args['x1']) / scale
  const y1 = Number(args['y1']) / scale
  const x2 = Number(args['x2']) / scale
  const y2 = Number(args['y2']) / scale
  const paddingX = Math.max(x2 - x1, 1) * ZOOM_PADDING
  const paddingY = Math.max(y2 - y1, 1) * ZOOM_PADDING
  const left = Math.min(Math.floor(Math.max(x1 - paddingX, 0)), frame.width)
  const top = Math.min(Math.floor(Math.max(y1 - paddingY, 0)), frame.height)

  return {
    x: frame.x + left, y: frame.y + top,
    width: Math.max(Math.floor(Math.min(x2 + paddingX, frame.width)) - left, 1),
    height: Math.max(Math.floor(Math.min(y2 + paddingY, frame.height)) - top, 1)
  }
}

/**
 * Checks GNOME frame identity and protects pixel input across layout changes.
 */
export class CuaWaylandCaptureAdapter implements ComputerUseDriver {
  public readonly setAgentCursorEnabled?: NonNullable<ComputerUseDriver['setAgentCursorEnabled']>
  private readonly observedLayouts = new Map<string, GnomeCaptureLayout>()
  private readonly windowCaptures = new Map<string, {
    bounds: Rectangle
    layout: GnomeCaptureLayout
    scale: number
  }>()

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
    this.windowCaptures.clear()
    return this.driver.shutdown()
  }
  public uniffiDestroy(): void { this.driver.uniffiDestroy() }

  public async callTool(name: string, argumentsJson: string): Promise<CuaToolResult> {
    const args = parseJsonRecord(argumentsJson) || {}

    if (name === 'get_window_state' && args['include_screenshot'] === false &&
        args['screenshot_out_file'] === undefined) {
      return this.driver.callTool(name, argumentsJson)
    }

    const session = String(args['session'] || '')
    const target = JSON.stringify([session, args['pid'], args['window_id']])
    if (!COMPUTER_USE_SCREEN_CAPTURE_ACTIONS.has(name)) {
      const previous = this.observedLayouts.get(session)
      const hasPixels = COMPUTER_USE_COORDINATE_FIELDS[name]?.some((key) => typeof args[key] === 'number')
      if (previous && hasPixels && JSON.stringify(await this.getLayout()) !== JSON.stringify(previous)) {
        throw new Error('The display layout changed since the last screenshot. Observe again before input.')
      }
      if (name === 'end_session') {
        this.observedLayouts.delete(session)
        for (const key of this.windowCaptures.keys()) {
          if (JSON.parse(key)[0] === session) this.windowCaptures.delete(key)
        }
      }
      return this.driver.callTool(name, argumentsJson)
    }

    const layout = await this.getLayout()
    let previousCapture = this.windowCaptures.get(target)

    // Cua applies the observed screenshot's resize when it computes the crop.
    if (name === 'zoom') {
      if (args['session'] === undefined) {
        // Without a session label, only use an unambiguous observation.
        const matchingCaptures = [...this.windowCaptures].filter(([key]) => {
          const [, pid, windowId] = JSON.parse(key)
          return pid === args['pid'] && windowId === args['window_id']
        })
        previousCapture = matchingCaptures.length === 1 ? matchingCaptures[0]?.[1] : undefined
      }
      if (!previousCapture || JSON.stringify(previousCapture.layout) !== JSON.stringify(layout)) {
        throw new Error('Observe the full window before zooming with its screenshot coordinates.')
      }
    } else if (name === 'get_window_state') {
      this.windowCaptures.delete(target)
    }

    const result = await this.driver.callTool(name, argumentsJson)
    if (hasCuaError(result) || !result.images.length) return result

    const state = parseJsonRecord(result.structuredJson)
    if (!state) throw new Error('Cua capture has no coordinate metadata.')

    const image = result.images.at(-1)!
    // A stage-based WinRects capture can have the expected dimensions but
    // crop physical pixels at logical offsets. Use a normalized desktop crop
    // unless the stage has one unscaled, unrotated output.
    const needsDesktopCrop = name !== 'get_desktop_state' && !layout.unscaledSingleMonitor
    let desktop = result
    let crop: Rectangle | undefined
    let windowCapture: { bounds: Rectangle, scale: number } | undefined

    if (name === 'get_window_state' || name === 'zoom') {
      const pid = name === 'zoom' ? args['pid'] : state['pid']
      const windowId = name === 'zoom' ? args['window_id'] : state['window_id']
      if (state['screenshot_frame_valid'] === false) {
        return { ...result, images: [] }
      }
      if (!Number.isInteger(pid) || !Number.isInteger(windowId) ||
          (args['pid'] !== undefined && args['pid'] !== pid) ||
          (args['window_id'] !== undefined && args['window_id'] !== windowId)) {
        throw new Error('Cua did not establish the requested window identity. Observe it again.')
      }

      if (needsDesktopCrop) {
        desktop = await this.driver.callTool('get_desktop_state', JSON.stringify({ session: args['session'] }))
        if (hasCuaError(desktop)) return desktop
      }

      const windowsResult = await this.driver.callTool('list_windows', JSON.stringify({ session: args['session'] }))
      if (hasCuaError(windowsResult)) return windowsResult

      const windows = parseJsonRecord(windowsResult.structuredJson)?.['windows'] as Record<string, unknown>[] | undefined
      const window = windows?.find((entry) => entry['window_id'] === windowId && entry['pid'] === pid)
      const currentBounds = asRecord(window?.['bounds'])
      const expectedBounds = name === 'zoom' ? previousCapture?.bounds : asRecord(state['window_bounds'])
      if (!currentBounds || window?.['is_on_screen'] !== true ||
          ['x', 'y', 'width', 'height'].some((key) =>
            !Number.isInteger(currentBounds[key]) || expectedBounds?.[key as keyof Rectangle] !== currentBounds[key]
          )) {
        throw new Error('The window moved or became unavailable during capture. Observe it again.')
      }
      const frame = {
        x: Number(currentBounds['x']), y: Number(currentBounds['y']),
        width: Number(currentBounds['width']), height: Number(currentBounds['height'])
      }
      if (frame.x < 0 || frame.y < 0 || frame.width <= 0 || frame.height <= 0 ||
          frame.x + frame.width > layout.width || frame.y + frame.height > layout.height) {
        throw new Error('The window is partly outside the captured desktop. Move it fully on screen and observe again.')
      }

      // Older WinRects helpers let Cua crop the stage, where a covering
      // window can appear even when Cua reports valid frame metadata.
      const overlapping = windows?.filter((entry) => {
        if (entry === window || entry['is_on_screen'] !== true) return false
        const other = asRecord(entry['bounds'])
        if (!other) return true
        const overlaps = Number(other['x']) < frame.x + frame.width &&
          Number(other['x']) + Number(other['width']) > frame.x &&
          Number(other['y']) < frame.y + frame.height &&
          Number(other['y']) + Number(other['height']) > frame.y
        return overlaps && (typeof entry['z_index'] !== 'number' ||
          typeof window?.['z_index'] !== 'number' || entry['z_index'] > window['z_index'])
      }) || []
      if (overlapping.length) {
        const failure = {
          code: CUA_WINDOW_CAPTURE_OCCLUDED_ERROR_CODE,
          detail: 'Another window covers this GNOME desktop crop. It cannot be presented as an image of the requested window.',
          pid, window_id: windowId,
          covering_windows: overlapping.map((entry) => ({
            pid: entry['pid'], window_id: entry['window_id'], title: entry['title']
          }))
        }
        return {
          ...result, images: [], isError: true, errorCode: failure.code,
          text: failure.detail, structuredJson: JSON.stringify(failure), rawJson: JSON.stringify(failure)
        }
      }

      if (name === 'get_window_state') {
        const { width, height } = readPngDimensions(Buffer.from(image.dataBase64, 'base64'))
        const scale = state['frame_scale'] ?? 1
        // The backend can round the resized dimensions to whole pixels.
        if (state['screenshot_frame_valid'] !== true ||
            width !== state['screenshot_width'] || height !== state['screenshot_height'] ||
            typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 1 ||
            Math.abs(width - frame.width * scale) >= 1 || Math.abs(height - frame.height * scale) >= 1) {
          throw new Error('Cua capture does not match the logical window frame. Observe it again.')
        }
        windowCapture = { bounds: frame, scale }
        crop = frame
      } else if (needsDesktopCrop && previousCapture) {
        crop = getZoomCrop(args, frame, previousCapture.scale)
      }
    }

    const current = await this.getLayout()
    if (JSON.stringify(current) !== JSON.stringify(layout)) {
      throw new Error('The display layout changed during capture. Observe again.')
    }

    let capture = result
    if (name === 'get_desktop_state' || needsDesktopCrop) {
      const desktopImage = desktop.images.at(-1)
      if (!desktopImage) {
        throw new Error('Cua returned no desktop image for capture.')
      }
      const output = crop ? {
        width: Number(state[name === 'zoom' ? 'width' : 'screenshot_width']),
        height: Number(state[name === 'zoom' ? 'height' : 'screenshot_height'])
      } : undefined
      const png = await normalizeGnomeCapture(
        Buffer.from(desktopImage.dataBase64, 'base64'), layout, crop, output
      )
      const corrected = {
        ...state,
        ...(crop ? {} : {
          screen_width: layout.width, screen_height: layout.height,
          screenshot_width: layout.width, screenshot_height: layout.height, scale_factor: 1
        }),
        ...(name === 'zoom' ? { format: 'png', mime_type: 'image/png' } : { screenshot_mime_type: 'image/png' })
      }
      capture = {
        ...result, text: '',
        images: [{ dataBase64: png.toString('base64'), mimeType: 'image/png' }],
        structuredJson: JSON.stringify(corrected), rawJson: JSON.stringify(corrected)
      }
    }

    this.observedLayouts.set(session, current)
    if (windowCapture) {
      const windowTarget = JSON.stringify([session, state['pid'], state['window_id']])
      this.windowCaptures.set(windowTarget, { ...windowCapture, layout: current })
    }

    return capture
  }
}
