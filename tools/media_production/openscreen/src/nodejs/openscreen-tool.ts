import { randomInt, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { PROFILE_SESSIONS_PATH } from '@bridge/constants'
import { ToolRuntimeLifetime } from '@bridge/tool-runtime-types'
import type { ToolExecutionContext } from '@sdk/tool-runtime-types'

import { CliProcess } from './lib/cli-process'
import { OpenScreenSession, type OpenScreenResult } from './lib/openscreen-session'
import { analyseMedia, type TimeSpan } from './lib/media-analysis'
import { planIdleTrims, subtractSpans, trimmingSettings, type CaptureEvidence, type CursorSample } from './lib/idle-trimming'

const DEFAULT_RECORDING_SECONDS = 120
const MAX_RECORDING_SECONDS = 3_600
const MAX_HISTORY = 16
const MAX_SESSIONS = 4
const MAX_POINTER_EVENTS = 10_000
const MAX_POINTER_JOURNAL_BYTES = 10 * 1_024 * 1_024
const MAX_CURSOR_BYTES = 64 * 1_024 * 1_024
const MAX_INPUT_EVENTS = 100_000

enum RecordingState {
  Recording = 'recording',
  Stopping = 'stopping',
  Failed = 'failed',
  Completed = 'completed'
}

interface Recording {
  id: string
  owner: string
  session: OpenScreenSession
  startedAt: number
  endedAt?: number
  title?: string
  browserTabId?: string
  systemPicker: boolean
  hasCamera: boolean
  state: RecordingState
  context?: ToolExecutionContext
  timer?: NodeJS.Timeout
  finishing?: Promise<void>
  result?: Record<string, unknown>
  error?: string
}

/**
 * A browser action in the recorded window, on the same wall clock as the take.
 */
export interface PointerEvent {
  at: number
  x: number
  y: number
  click?: boolean
}

/**
 * Capture requires one explicit source; audio and camera stay off unless enabled.
 */
export interface RecordingOptions {
  windowTitle?: string
  displayIndex?: number
  systemPicker?: boolean
  durationSeconds?: number
  title?: string
  browserTabId?: string
  microphone?: boolean
  microphoneDevice?: string
  systemAudio?: boolean
  camera?: boolean
  cameraDevice?: string
}

/**
 * MP4 and GIF exports use the corresponding upstream renderer options.
 */
export interface ExportOptions {
  format?: 'mp4' | 'gif'
  quality?: 'medium' | 'good' | 'source'
  fps?: 24 | 30 | 60
  autoZoom?: boolean
  gifFps?: 15 | 20 | 25 | 30
  gifSize?: 'small' | 'medium' | 'large' | 'original'
  gifLoop?: boolean
}

/**
 * Owns managed OpenScreen sessions while upstream validates edits and plans zooms.
 */
export default class OpenScreenTool extends Tool {
  public readonly runtimeLifetime = ToolRuntimeLifetime.Persistent
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)
  private readonly sessions = new Map<string, OpenScreenSession>()
  private readonly recordings = new Map<string, Recording>()
  private readonly dataDirectory = path.join(path.dirname(this.getSettingsPath()), 'data')

  public constructor() {
    super()
    this.settings = ToolkitConfig.loadToolSettings(this.toolkit, this.toolName)
    this.checkRequiredSettings()
  }

  public get toolName(): string {
    return 'openscreen'
  }

  public get toolkit(): string {
    return 'media_production'
  }

  public get description(): string {
    return this.config.description
  }

  /**
   * Lists upstream capture titles and device labels without selecting a source.
   */
  public async sources(): Promise<unknown> {
    return (await this.call('listSources', {})).data
  }

  /**
   * Starts an explicitly selected take, retaining its actual capture-start clock.
   */
  public async start(options: RecordingOptions): Promise<unknown> {
    const owner = this.requireOwner()
    if ([...this.recordings.values()].some((item) =>
      item.state === RecordingState.Recording || item.state === RecordingState.Stopping
    )) {
      throw new Error('A recording is already active in this profile. Stop it first.')
    }

    const selected = [options.windowTitle !== undefined, options.displayIndex !== undefined,
      options.systemPicker === true].filter(Boolean).length
    const duration = options.durationSeconds ?? DEFAULT_RECORDING_SECONDS
    if (selected !== 1 || !Number.isInteger(duration) || duration < 1 || duration > MAX_RECORDING_SECONDS) {
      throw new Error('Select exactly one source and a duration from 1 to 3600 seconds.')
    }
    const wayland = process.platform === 'linux' && (
      process.env['XDG_SESSION_TYPE'] === 'wayland' || Boolean(process.env['WAYLAND_DISPLAY'])
    )
    if (wayland !== Boolean(options.systemPicker)) {
      throw new Error('Wayland requires systemPicker and owner portal selection; other desktops require an explicit window or display.')
    }
    if (options.browserTabId && !options.windowTitle && !options.systemPicker) {
      throw new Error('Browser pointer tracking requires a selected browser windowTitle or a Wayland systemPicker. Keep browserTabId when selecting the browser window.')
    }
    if (options.microphoneDevice && options.microphone !== true) {
      throw new Error('microphoneDevice requires microphone=true.')
    }
    if (options.cameraDevice && options.camera !== true) {
      throw new Error('cameraDevice requires camera=true.')
    }

    const session = await this.session()
    // The portal owns source selection and can list windows unavailable to OpenScreen.
    if (!options.systemPicker) {
      const sources = (await this.call('listSources', {}, session)).data
      const { windowTitle, displayIndex } = options
      if (windowTitle !== undefined) {
        const matches = (sources['windows'] as string[]).filter((title) =>
          title.toLowerCase().includes(windowTitle.toLowerCase())
        )
        if (!windowTitle.trim() || matches.length !== 1) {
          throw new Error(`Choose a unique window title from refreshed sources; upstream selects by substring. Matching windows: ${JSON.stringify(matches)}. For browser capture, keep browserTabId and resolve the window selection before recording.`)
        }
      }
      if (displayIndex !== undefined && !(sources['displays'] as { index: number }[])
        .some((display) => display.index === displayIndex)) {
        throw new Error('The selected display is unavailable. Refresh sources.')
      }
    }

    const started = (await this.call('startRecording', {
      ...(options.windowTitle !== undefined ? { window: options.windowTitle } : {}),
      ...(options.displayIndex !== undefined ? { display: options.displayIndex } : {}),
      microphone: options.microphoneDevice ?? options.microphone === true,
      systemAudio: options.systemAudio === true,
      camera: options.cameraDevice ?? options.camera === true
    }, session)).data
    if (typeof started['startedAt'] !== 'number') {
      await session.dispose()
      throw new Error('OpenScreen did not confirm capture start.')
    }

    for (const [id, item] of this.recordings) {
      if (this.recordings.size < MAX_HISTORY) {
        break
      }
      if (item.state !== RecordingState.Recording && item.state !== RecordingState.Stopping) {
        this.recordings.delete(id)
      }
    }
    const recording: Recording = {
      id: randomUUID(), owner, session, startedAt: started['startedAt'],
      state: RecordingState.Recording,
      systemPicker: options.systemPicker === true,
      hasCamera: options.camera === true,
      ...(options.title ? { title: options.title } : {}),
      ...(options.browserTabId ? { browserTabId: options.browserTabId } : {}),
      ...(this.executionContext ? { context: this.executionContext } : {})
    }
    this.recordings.set(recording.id, recording)
    this.recordingOutput(recording, 'OpenScreen capture started.\n', 'running')
    // A retained capture outlives its start call; this bounds the capture itself.
    recording.timer = setTimeout(() => {
      void this.finish(recording).catch(() => {})
    }, duration * 1_000)

    return this.status(recording.id)
  }

  /**
   * Reads only handles created by the current conversation.
   */
  public async status(sessionId: string): Promise<unknown> {
    const recording = this.ownedRecording(sessionId)
    return {
      sessionId,
      startedAt: recording.startedAt,
      state: recording.state,
      running: recording.state === RecordingState.Recording || recording.state === RecordingState.Stopping,
      ...(recording.browserTabId ? { browserTabId: recording.browserTabId } : {}),
      ...(recording.result ?? {}),
      ...(recording.error ? { error: recording.error } : {})
    }
  }

  /**
   * Finalizes capture once and links Wayland browser evidence after source review.
   */
  public async stop(sessionId: string, browserWindowVerified = false): Promise<unknown> {
    const recording = this.ownedRecording(sessionId)
    const context = this.executionContext ?? undefined
    if (browserWindowVerified) {
      if (recording.state !== RecordingState.Completed || !recording.systemPicker || !recording.browserTabId) {
        throw new Error('Stop the Wayland browser take and preview the selected window before confirming it.')
      }
      if (recording.result?.['browserWindowVerificationRequired']) {
        await this.applyBrowserEvidence(recording, context)
        await this.reportZooms(recording, context)
        delete recording.result['browserWindowVerificationRequired']
      }
    }
    await this.finish(recording, context)
    if ((recording.result?.['optimization'] as { status?: string } | undefined)?.status === 'pending') {
      recording.result!['optimization'] = await this.optimizeRecording(String(recording.result!['projectId']))
    }
    return this.status(sessionId)
  }

  /**
   * Reads the document, zooms, appearance and upstream setting choices.
   */
  public async info(projectId: string): Promise<unknown> {
    return (await this.call('getCurrentDocument', { projectId })).data
  }

  /**
   * Shortens confirmed idle footage using saved capture evidence and native project cuts.
   */
  public async optimizeRecording(projectId: string): Promise<unknown> {
    const session = await this.session()
    await this.call('getCurrentDocument', { projectId }, session)
    let evidence: CaptureEvidence
    try {
      evidence = JSON.parse(await fs.readFile(this.captureEvidencePath(projectId, this.requireOwner()), 'utf8')) as CaptureEvidence
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { status: 'skipped', reason: 'Automatic trimming requires a linked browser capture with delivered-input timing.' }
      }
      throw error
    }
    return this.optimize(projectId, session, evidence, this.executionContext ?? undefined)
  }

  /**
   * Imports explicitly supplied footage into the conversation's own project store.
   */
  public async createProject(videoPath: string, title?: string): Promise<unknown> {
    await this.requireFile(videoPath)
    const created = (await this.call('createProject', {
      videoPath: await fs.realpath(videoPath), ...(title ? { title } : {})
    })).data
    const projectId = String(created['projectId'])
    await this.applyDefaults(projectId, await this.session(), this.executionContext ?? undefined)
    return created
  }

  /**
   * Changes only supplied settings; upstream validates names, values and ranges.
   */
  public async setEditorSettings(projectId: string, settings: Record<string, unknown>): Promise<unknown> {
    return this.edit('setEditorSettings', projectId, await this.resolveWallpaper(
      projectId, settings, await this.session(), this.executionContext ?? undefined
    ))
  }

  /**
   * Replaces scripted pointer data and returns the number of planned zoom regions.
   */
  public async setPointerTrack(projectId: string, events: PointerEvent[]): Promise<unknown> {
    this.requireVerifiedBrowserWindow(projectId)
    if (!events.length || events.length > MAX_POINTER_EVENTS) {
      throw new Error(`Supply from 1 to ${MAX_POINTER_EVENTS} observed pointer events.`)
    }
    return this.edit('setPointerTrack', projectId, { events })
  }

  /**
   * Transcribes on-device, then enables captions through the document editor.
   */
  public async captions(projectId: string): Promise<unknown> {
    const transcript = await this.edit('transcribe', projectId, {})
    const captions = await this.edit('setCaptionSettings', projectId, { enabled: true })
    return { projectId, transcript, captions }
  }

  /**
   * Renders selected ruler-time frames and supplies them to the model for review.
   */
  public async preview(projectId: string, atSeconds: number[]): Promise<unknown> {
    const result = await this.call('getFrames', { projectId, atSec: atSeconds })
    this.attachModelFiles(result.images)
    return { ...result.data, suppliedFrames: result.images.length }
  }

  /**
   * Exports the edited document and delivers only a successful, nonempty file.
   */
  public async exportRecording(projectId: string, outputDirectory: string, options: ExportOptions = {}): Promise<unknown> {
    this.requireVerifiedBrowserWindow(projectId)
    const format = options.format ?? 'mp4'
    if (format === 'gif' && (options.quality !== undefined || options.fps !== undefined)) {
      throw new Error('quality and fps apply only to MP4; use GIF options instead.')
    }
    if (format === 'mp4' && (options.gifFps !== undefined || options.gifSize !== undefined || options.gifLoop !== undefined)) {
      throw new Error('GIF options apply only to GIF exports.')
    }
    const directory = await this.newDirectory(outputDirectory)
    const outputPath = path.join(directory, `recording.${format}`)
    const autoZoom = options.autoZoom === false ? undefined : await this.edit('addAutoZooms', projectId, {})
    const result = (await this.call('exportVideo', {
      projectId, path: outputPath,
      ...(format === 'mp4' ? { quality: options.quality ?? 'source', fps: options.fps ?? 60 } : {
        ...(options.gifFps !== undefined ? { gifFrameRate: options.gifFps } : {}),
        ...(options.gifSize !== undefined ? { gifSize: options.gifSize } : {}),
        ...(options.gifLoop !== undefined ? { gifLoop: options.gifLoop } : {})
      })
    })).data
    const sizeBytes = await this.requireFile(outputPath)
    this.executionContext?.signal?.throwIfAborted()
    const document = (await this.call('getCurrentDocument', { projectId })).data
    const zooms = Array.isArray(document['zoomRanges']) ? document['zoomRanges'].length : 0
    const warnings = options.autoZoom !== false && zooms === 0
      ? ['No zoom regions were generated. Scripted capture needs a pointer track with clicks; preview before claiming automatic focus.'] : []
    const artifact = await this.createArtifact(outputPath, format === 'mp4' ? 'video/mp4' : 'image/gif')
    return { ...result, outputPath, sizeBytes, zoomRegions: zooms, autoZoom, warnings, artifacts: [artifact] }
  }

  /**
   * Retains upstream packing for legacy CLI project files only.
   */
  public async pack(projectPath: string, outputDirectory: string): Promise<unknown> {
    await this.requireFile(projectPath)
    const directory = await this.newDirectory(outputDirectory)
    const cli = new CliProcess(await this.executable(), [
      `--user-data-dir=${await this.sessionDirectory()}`, 'pack', await fs.realpath(projectPath), '--out', directory, '--json'
    ], (text) => this.emitOutput(text))
    const cancel = (): void => {
      void cli.cancel().catch(() => {})
    }
    const signal = this.executionContext?.signal
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      signal?.throwIfAborted()
      return await cli.done
    } finally {
      signal?.removeEventListener('abort', cancel)
      await cli.dispose()
    }
  }

  /**
   * Stops retained captures before releasing the upstream processes.
   */
  public async dispose(): Promise<void> {
    try {
      await Promise.all([...this.recordings.values()].filter((recording) =>
        recording.state === RecordingState.Recording || recording.state === RecordingState.Stopping
      ).map((recording) => this.finish(recording).catch(() => {})))
    } finally {
      await Promise.all([...this.sessions.values()].map((session) => session.dispose()))
    }
  }

  private async finish(recording: Recording, context?: ToolExecutionContext): Promise<void> {
    if (recording.finishing) {
      return recording.finishing
    }
    recording.finishing = this.finalize(recording, context)
    return recording.finishing
  }

  /**
   * Saves the take and links scripted input when the capture source is known.
   */
  private async finalize(recording: Recording, context?: ToolExecutionContext): Promise<void> {
    clearTimeout(recording.timer)
    recording.endedAt = Date.now()
    recording.state = RecordingState.Stopping
    try {
      const result = (await this.request(recording.session, 'stopRecording', {
        ...(recording.title ? { title: recording.title } : {})
      }, context, (text) => this.recordingOutput(recording, text, 'running'))).data
      const projectId = String(result['projectId'])
      recording.result = result
      result['videoPathNote'] = 'videoPath is the raw capture. Use exportRecording to render the project trims, background, cursor and zooms before delivery or importing into another editor.'
      await this.applyDefaults(projectId, recording.session, context)
      if (recording.systemPicker && recording.browserTabId) {
        // The portal does not tell the recorder which browser window it captured.
        result['browserWindowVerificationRequired'] = true
      } else {
        if (recording.browserTabId) {
          await this.applyBrowserEvidence(recording, context)
        }
        await this.reportZooms(recording, context)
      }
      recording.state = RecordingState.Completed
      this.recordingOutput(recording, 'OpenScreen capture finalized.\n', 'completed')
    } catch (error) {
      recording.state = RecordingState.Failed
      recording.error = String(error)
      this.recordingOutput(recording, `${recording.error}\n`, 'failed')
      throw error
    }
  }

  /**
   * Uses delivered browser input to place the cursor and preserve interactions during trimming.
   */
  private async applyBrowserEvidence(recording: Recording, context?: ToolExecutionContext): Promise<void> {
    const result = recording.result!
    const projectId = String(result['projectId'])

    const events = await this.browserEvents(recording)
    result['pointerEventsImported'] = events.length
    if (events.length) {
      const pointer = (await this.request(recording.session, 'setPointerTrack', { projectId, events }, context)).data
      result['pointerTrack'] = pointer
    }
    try {
      const inputRanges = (await this.browserJournals(recording, '.input-activity.json')).flatMap((entry) => {
        const start = Number(entry['startedAt'])
        const end = Number(entry['endedAt'])
        if (entry['tab_id'] !== recording.browserTabId || !Number.isFinite(start) || !Number.isFinite(end) ||
          end < start || start < recording.startedAt || end > recording.endedAt!) {
          return []
        }
        return [{ startSec: (start - recording.startedAt) / 1_000,
          endSec: Math.max(end - recording.startedAt, start - recording.startedAt + 1) / 1_000 }]
      })
      if (inputRanges.length) {
        const evidence: CaptureEvidence = {
          videoPath: String(result['videoPath']),
          firstInputSec: inputRanges.reduce((first, span) => Math.min(first, span.startSec), Infinity),
          inputRanges, hasCamera: recording.hasCamera
        }
        const filename = this.captureEvidencePath(projectId, recording.owner)
        await fs.writeFile(`${filename}.tmp`, JSON.stringify(evidence))
        await fs.rename(`${filename}.tmp`, filename)
        // Expiry and worker shutdown save evidence; analysis needs an active host deadline.
        result['optimization'] = context
          ? await this.optimize(projectId, recording.session, evidence, context)
          : { status: 'pending', reason: 'Run optimizeRecording under an active tool call before exporting.' }
      } else {
        result['optimization'] = { status: 'skipped', reason: 'No delivered-input timing was available; the full take was preserved.' }
      }
    } catch (error) {
      context?.signal?.throwIfAborted()
      // A completed capture remains usable when optional analysis is unavailable.
      result['optimization'] = { status: 'failed', reason: String(error) }
    }
  }

  /**
   * Reports focus regions from the edited project so zero zooms can be reviewed before export.
   */
  private async reportZooms(recording: Recording, context?: ToolExecutionContext): Promise<void> {
    const result = recording.result!
    const projectId = String(result['projectId'])
    const document = (await this.request(recording.session, 'getCurrentDocument', { projectId }, context)).data

    result['autoZooms'] = Array.isArray(document['zoomRanges']) ? document['zoomRanges'].length : 0
    if (result['autoZooms'] === 0) {
      result['warnings'] = [...(Array.isArray(result['warnings']) ? result['warnings'] : []),
        'No zoom regions were generated. Browser automation requires browserTabId linked to the recorded window and matching delivered pointer events. Inspect info and preview before claiming cursor motion or zoom.']
    }
  }

  /**
   * Imports only the linked tab's input delivered during this conversation's take.
   */
  private async browserEvents(recording: Recording): Promise<PointerEvent[]> {
    const events: PointerEvent[] = []
    for (const event of await this.browserJournals(recording, '.pointer.json')) {
      const at = Number(event['at'])
      if (event['tab_id'] === recording.browserTabId && at >= recording.startedAt && at <= recording.endedAt!) {
        events.push({ at, x: Number(event['x']), y: Number(event['y']), ...(event['click'] ? { click: true } : {}) })
      }
    }
    if (events.length > MAX_POINTER_EVENTS) {
      throw new Error('Browser pointer history exceeds the bounded recording event limit.')
    }
    return events.sort((first, second) => first.at - second.at)
  }

  /**
   * Reads bounded evidence only from the capture owner's browser artifacts.
   */
  private async browserJournals(recording: Recording, suffix: string): Promise<Record<string, unknown>[]> {
    const directory = path.join(PROFILE_SESSIONS_PATH, encodeURIComponent(recording.owner), 'artifacts', 'browser_use')
    const entries: Record<string, unknown>[] = []
    let files: string[]
    try {
      files = await fs.readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return entries
      }
      throw error
    }
    for (const name of files.filter((name) => name.endsWith(suffix))) {
      const filename = path.join(directory, name)
      const stats = await fs.stat(filename)
      if (stats.mtimeMs < recording.startedAt) {
        continue
      }
      if (stats.size > MAX_POINTER_JOURNAL_BYTES) {
        throw new Error('Browser pointer journal exceeds the bounded recording input limit.')
      }
      const batch = JSON.parse(await fs.readFile(filename, 'utf8')) as Record<string, unknown>[]
      if (!Array.isArray(batch) || entries.length + batch.length > MAX_INPUT_EVENTS) {
        throw new Error('Browser activity exceeds the bounded recording evidence limit.')
      }
      for (const entry of batch) {
        entries.push(entry)
      }
    }
    return entries
  }

  private captureEvidencePath(projectId: string, owner: string): string {
    return path.join(this.dataDirectory, encodeURIComponent(owner), `${encodeURIComponent(projectId)}.capture.json`)
  }

  /**
   * Apply only source-time cuts to a simple take; authored layouts and audio stay protected.
   */
  private async optimize(
    projectId: string,
    session: OpenScreenSession,
    evidence: CaptureEvidence,
    context?: ToolExecutionContext,
    output = (text: string): void => this.emitOutput(text, undefined, context)
  ): Promise<unknown> {
    this.settings = ToolkitConfig.loadToolSettings(this.toolkit, this.toolName, {}, true)
    const settings = trimmingSettings(this.settings['trimming'])
    if (!settings.enabled) {
      return { status: 'disabled' }
    }
    const started = performance.now()
    const document = (await this.request(session, 'getCurrentDocument', { projectId }, context, output)).data
    const clips = document['clips'] as { id: string, assetId: string, sourceStartSec: number, timelineStartSec: number, sourceEndSec: number }[]
    if (evidence.hasCamera || clips.length !== 1 || clips[0]!.sourceStartSec !== 0 || clips[0]!.timelineStartSec !== 0 ||
      (document['speedRegions'] as unknown[]).length || (document['audioTracks'] as unknown[]).length) {
      return { status: 'skipped', reason: 'Automatic trimming preserves webcam, imported audio and complex edited timelines.' }
    }
    await this.requireFile(evidence.videoPath)
    const cursorPath = `${evidence.videoPath}.cursor.json`
    if ((await fs.stat(cursorPath)).size > MAX_CURSOR_BYTES) {
      throw new Error('Cursor data exceeds the bounded analysis limit.')
    }
    const cursor = JSON.parse(await fs.readFile(cursorPath, 'utf8')) as { samples: CursorSample[] }
    if (!Array.isArray(cursor.samples) || !cursor.samples.length || !evidence.inputRanges.length ||
      cursor.samples.some((sample) => !Number.isFinite(sample.timeMs) || !Number.isFinite(sample.cx) || !Number.isFinite(sample.cy))) {
      return { status: 'skipped', reason: 'Cursor and delivered-input evidence are required to protect interactive content.' }
    }
    const analysis = await analyseMedia(evidence.videoPath, settings, context?.signal, output)
    // Refresh after the scan so edits made while a background take finishes are respected.
    const current = (await this.request(session, 'getCurrentDocument', { projectId }, context, output)).data
    if (JSON.stringify(current['clips']) !== JSON.stringify(document['clips']) ||
      (current['speedRegions'] as unknown[]).length || (current['audioTracks'] as unknown[]).length) {
      return { status: 'skipped', reason: 'The edited timeline changed during analysis; no automatic cuts were added.' }
    }
    const cuts = planIdleTrims(current, evidence, cursor.samples, analysis, settings)
    if (!cuts.length) {
      return { status: 'unchanged', cuts: [], removedSeconds: 0, analysisSeconds: (performance.now() - started) / 1_000 }
    }
    const checkpoint = (await this.request(session, 'createCheckpoint', { projectId }, context, output)).data
    try {
      await this.request(session, 'addTrims', { projectId, ranges: cuts.map((cut) => ({ ...cut,
        assetId: clips[0]!.assetId, clipId: clips[0]!.id, reason: 'Shorten confirmed silent idle footage' })) }, context, output)
      const edited = (await this.request(session, 'getCurrentDocument', { projectId }, context, output)).data
      if (subtractSpans(cuts, edited['trimRanges'] as TimeSpan[]).length) {
        throw new Error('OpenScreen did not confirm every proposed idle cut.')
      }
      return { status: 'applied', cuts, removedSeconds: cuts.reduce((sum, cut) => sum + cut.endSec - cut.startSec, 0),
        analysisSeconds: (performance.now() - started) / 1_000, checkpoint }
    } catch (error) {
      if (!context?.signal?.aborted) {
        await this.request(session, 'restoreCheckpoint', { projectId, checkpointId: checkpoint['checkpointId'] }, context, output)
      }
      throw error
    }
  }

  /**
   * Seeds new projects once; ordinary edits and exports preserve their current look.
   */
  private async applyDefaults(projectId: string, session: OpenScreenSession, context?: ToolExecutionContext): Promise<void> {
    this.settings = ToolkitConfig.loadToolSettings(this.toolkit, this.toolName, {}, true)
    const editor = this.settings['editor']
    if (!editor || typeof editor !== 'object' || Array.isArray(editor)) {
      throw new Error('OpenScreen editor settings must be an object.')
    }
    const settings = await this.resolveWallpaper(projectId, editor as Record<string, unknown>, session, context)
    await this.request(session, 'setEditorSettings', { projectId, ...settings }, context)
  }

  /**
   * An empty owner preference selects from the wallpapers this app actually offers.
   */
  private async resolveWallpaper(
    projectId: string,
    settings: Record<string, unknown>,
    session: OpenScreenSession,
    context?: ToolExecutionContext
  ): Promise<Record<string, unknown>> {
    if (settings['wallpaper'] !== '') {
      return settings
    }
    const document = (await this.request(session, 'getCurrentDocument', { projectId }, context)).data
    const available = (document['settingsContext'] as { bundledWallpapers?: unknown[] } | undefined)?.bundledWallpapers
    const wallpapers = available?.filter((item): item is string => typeof item === 'string') ?? []
    const resolved = { ...settings }
    delete resolved['wallpaper']
    if (wallpapers.length) {
      resolved['wallpaper'] = wallpapers[randomInt(wallpapers.length)]
    }
    return resolved
  }

  private async edit(name: string, projectId: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    // A new connection has no checkpoints, even when the project survived a restart.
    await this.call('createCheckpoint', { projectId })
    return (await this.call(name, { ...args, projectId })).data
  }

  private async call(name: string, args: Record<string, unknown>, session?: OpenScreenSession): Promise<OpenScreenResult> {
    return this.request(session ?? await this.session(), name, args, this.executionContext ?? undefined)
  }

  private async request(
    session: OpenScreenSession,
    name: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
    output = (text: string): void => this.emitOutput(text, undefined, context)
  ): Promise<OpenScreenResult> {
    return session.call(name, args, context, output)
  }

  /**
   * Bounds retained app processes and keeps every conversation's project store separate.
   */
  private async session(): Promise<OpenScreenSession> {
    const owner = this.requireOwner()
    const existing = this.sessions.get(owner)
    if (existing && !existing.closed) {
      return existing
    }
    for (const [id, session] of this.sessions) {
      if (session.closed || (this.sessions.size >= MAX_SESSIONS && ![...this.recordings.values()].some((recording) =>
        recording.session === session && (recording.state === RecordingState.Recording || recording.state === RecordingState.Stopping)
      ))) {
        await session.dispose()
        this.sessions.delete(id)
      }
    }
    const session = new OpenScreenSession(await this.executable(), await this.sessionDirectory())
    try {
      await session.connect()
    } catch (error) {
      await session.dispose()
      throw error
    }
    this.sessions.set(owner, session)
    return session
  }

  private async sessionDirectory(): Promise<string> {
    const directory = path.join(this.dataDirectory, encodeURIComponent(this.requireOwner()))
    await fs.mkdir(directory, { recursive: true })
    return fs.realpath(directory)
  }

  private requireOwner(): string {
    const owner = this.executionContext?.conversationSessionId
    if (!owner) {
      throw new Error('OpenScreen requires a conversation session.')
    }
    return owner
  }

  private ownedRecording(sessionId: string): Recording {
    const recording = this.recordings.get(sessionId)
    if (!recording || recording.owner !== this.requireOwner()) {
      throw new Error('No recording with that ID belongs to this conversation.')
    }
    return recording
  }

  /**
   * Keeps a portal-selected take in review until its browser window is verified.
   */
  private requireVerifiedBrowserWindow(projectId: string): void {
    const owner = this.requireOwner()
    if ([...this.recordings.values()].some(({ owner: recordingOwner, result }) =>
      recordingOwner === owner && result?.['projectId'] === projectId && result['browserWindowVerificationRequired']
    )) {
      throw new Error('Preview the Wayland take and confirm the recorded browser window with stop before adding pointer events or exporting.')
    }
  }

  private recordingOutput(recording: Recording, text: string, state: 'running' | 'completed' | 'failed'): void {
    this.emitOutput(text, { id: recording.id, state }, recording.context)
  }

  private async newDirectory(directory: string): Promise<string> {
    if (!path.isAbsolute(directory)) {
      throw new Error('Provide an absolute new output directory with an existing parent.')
    }
    this.executionContext?.signal?.throwIfAborted()
    await fs.mkdir(directory)
    return fs.realpath(directory)
  }

  private async requireFile(filename: string): Promise<number> {
    if (!path.isAbsolute(filename)) {
      throw new Error('Provide an absolute file path.')
    }
    const stats = await fs.stat(filename)
    if (!stats.isFile() || stats.size === 0) {
      throw new Error('The required file is missing, empty or not a regular file.')
    }
    return stats.size
  }

  private async executable(): Promise<string> {
    const configured = this.settings['executable_path']
    if (configured && (typeof configured !== 'string' || !path.isAbsolute(configured))) {
      throw new Error('executable_path must be an absolute OpenScreen executable path.')
    }
    const candidates: string[] = []
    if (typeof configured === 'string' && configured) {
      candidates.push(configured)
    } else {
      if (process.platform === 'darwin') {
        for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
          candidates.push(path.join(base, 'Openscreen.app', 'Contents', 'MacOS', 'Openscreen'))
        }
      } else if (process.platform === 'win32') {
        for (const base of [process.env['LOCALAPPDATA'], process.env['ProgramFiles']]) {
          if (base) {
            candidates.push(path.join(base, ...(base === process.env['LOCALAPPDATA'] ? ['Programs'] : []), 'Openscreen', 'Openscreen.exe'))
          }
        }
      }
      for (const directory of (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean)) {
        candidates.push(path.join(directory, process.platform === 'win32' ? 'Openscreen.exe' : 'openscreen'))
      }
    }
    for (const candidate of candidates) {
      try {
        await fs.access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        if ((await fs.stat(candidate)).isFile()) {
          return this.getBinaryPath(candidate, true)
        }
      } catch {
        // Continue installed locations; an explicit setting never falls back.
      }
    }

    if (!configured && ToolkitConfig.getBinaryUrl(this.config)) {
      return this.getBinaryPath('Openscreen')
    }

    throw new Error('OpenScreen was not found at the configured or standard executable locations, and no managed download applies. Install the desktop app from https://getopenscreen.com or correct executable_path. Grant screen/accessibility permissions yourself; I cannot approve them.')
  }
}
