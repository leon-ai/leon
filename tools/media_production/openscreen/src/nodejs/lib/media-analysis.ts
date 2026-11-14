import { spawn } from 'node:child_process'

import ToolManager from '@sdk/tool-manager'
import { terminateProcessTree } from '@sdk/utils/process'

const MAX_OUTPUT_CHARACTERS = 131_072
const MAX_DIAGNOSTIC_CHARACTERS = 16_000
const MAX_SPANS = 10_000
const SILENCE_NOISE_DB = -60
const SILENCE_DURATION_SECONDS = 0.25

/**
 * Source-time seconds, before project cuts or playback speed changes.
 */
export interface TimeSpan {
  startSec: number
  endSec: number
}

/**
 * Resolution and sensitivity affect analysis only, never the exported footage.
 */
export interface ScanSettings {
  minimumIdleSeconds: number
  noiseDb: number
  analysisWidth: number
}

/**
 * Observed stillness and silence; neither is itself permission to remove content.
 */
export interface MediaAnalysis {
  durationSec: number
  stillRanges: TimeSpan[]
  silentRanges: TimeSpan[]
}

/**
 * Runs an analysis process with bounded output and the caller's cancellation signal.
 */
async function runAnalysis(
  executable: string,
  args: string[],
  signal: AbortSignal | undefined,
  onOutput: (text: string) => void,
  onLine?: (line: string) => void
): Promise<string> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let diagnostics = ''
    let pending = ''
    let failure: Error | undefined
    const abort = (): void => {
      if (child.pid) {
        void terminateProcessTree(child.pid, 'SIGKILL').catch(reject)
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
    }
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (onLine) {
        onOutput(chunk)
      } else {
        stdout += chunk
        if (stdout.length > MAX_OUTPUT_CHARACTERS) {
          failure = new Error('Media metadata exceeds its bounded analysis limit.')
          abort()
        }
      }
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      diagnostics = (diagnostics + chunk).slice(-MAX_DIAGNOSTIC_CHARACTERS)
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop()!.slice(-MAX_DIAGNOSTIC_CHARACTERS)
      try {
        for (const line of lines) {
          onLine?.(line)
        }
      } catch (error) {
        failure = error as Error
        abort()
      }
    })
    child.once('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) {
        reject(signal.reason)
      } else if (failure || code !== 0) {
        reject(failure ?? new Error(`Media analysis failed: ${diagnostics}`))
      } else {
        try {
          onLine?.(pending)
          resolve(stdout)
        } catch (error) {
          reject(error)
        }
      }
    })
  })
}

/**
 * Detects still source frames and silent audio without producing another video.
 */
export async function analyseMedia(
  videoPath: string,
  settings: ScanSettings,
  signal: AbortSignal | undefined,
  onOutput: (text: string) => void
): Promise<MediaAnalysis> {
  signal?.throwIfAborted()
  // Share the media tools' managed installations instead of bundling extra binaries.
  const [ffmpegPath, ffprobePath] = await Promise.all([
    ToolManager.getToolBinaryPath('video_streaming', 'ffmpeg'),
    ToolManager.getToolBinaryPath('video_streaming', 'ffprobe')
  ])
  signal?.throwIfAborted()
  const probe = JSON.parse(await runAnalysis(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', videoPath
  ], signal, onOutput)) as { format: { duration: string }, streams: { codec_type: string }[] }
  const durationSec = Number(probe.format.duration)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('Media analysis requires a finite positive duration.')
  }
  const hasAudio = probe.streams.some((stream) => stream.codec_type === 'audio')
  const stillRanges: TimeSpan[] = []
  const silentRanges: TimeSpan[] = []
  let freezeStart: number | undefined
  let silenceStart: number | undefined
  const value = (line: string, key: string): number | undefined => {
    const index = line.indexOf(`${key}: `)
    const parsed = index < 0 ? NaN : Number.parseFloat(line.slice(index + key.length + 2))
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const append = (ranges: TimeSpan[], start: number | undefined, end: number): void => {
    if (start !== undefined && end > start) {
      if (ranges.length >= MAX_SPANS) {
        throw new Error('Media analysis exceeds its bounded interval limit.')
      }
      ranges.push({ startSec: Math.max(0, start), endSec: Math.min(durationSec, end) })
    }
  }
  await runAnalysis(ffmpegPath, [
    '-hide_banner', '-nostdin', '-nostats', '-progress', 'pipe:1', '-i', videoPath,
    '-vf', `scale=${settings.analysisWidth}:-2,freezedetect=n=${settings.noiseDb}dB:d=${settings.minimumIdleSeconds}`,
    ...(hasAudio ? ['-af', `silencedetect=n=${SILENCE_NOISE_DB}dB:d=${SILENCE_DURATION_SECONDS}`] : ['-an']),
    '-f', 'null', '-'
  ], signal, onOutput, (line) => {
    freezeStart = value(line, 'lavfi.freezedetect.freeze_start') ?? freezeStart
    silenceStart = value(line, 'silence_start') ?? silenceStart
    const freezeEnd = value(line, 'lavfi.freezedetect.freeze_end')
    const silenceEnd = value(line, 'silence_end')
    if (freezeEnd !== undefined) {
      append(stillRanges, freezeStart, freezeEnd)
      freezeStart = undefined
    }
    if (silenceEnd !== undefined) {
      append(silentRanges, silenceStart, silenceEnd)
      silenceStart = undefined
    }
  })
  append(stillRanges, freezeStart, durationSec)
  append(silentRanges, silenceStart, durationSec)
  return { durationSec, stillRanges, silentRanges: hasAudio ? silentRanges : [{ startSec: 0, endSec: durationSec }] }
}
