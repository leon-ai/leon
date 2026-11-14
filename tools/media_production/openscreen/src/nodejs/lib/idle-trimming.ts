import type { MediaAnalysis, ScanSettings, TimeSpan } from './media-analysis'

const ACTIVITY_PADDING_SECONDS = 0.25
const MINIMUM_CUT_SECONDS = 0.1
const TIME_EPSILON_SECONDS = 0.001

/**
 * Owner controls for conservative opening and whole-take idle compression.
 */
export interface TrimmingSettings extends ScanSettings {
  enabled: boolean
  leadInSeconds: number
  keepIdleSeconds: number
}

/**
 * Only delivered input timing is retained, without typed text or key contents.
 */
export interface CaptureEvidence {
  videoPath: string
  firstInputSec: number
  inputRanges: TimeSpan[]
  hasCamera: boolean
}

/**
 * Original cursor samples preserve motion that a low-resolution frame scan can miss.
 */
export interface CursorSample {
  timeMs: number
  cx: number
  cy: number
  visible?: boolean
  assetId?: string | null
  interactionType?: string | null
}

/**
 * Validate settings supplied through the inherited tool settings store.
 */
export function trimmingSettings(value: unknown): TrimmingSettings {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenScreen trimming settings must be an object.')
  }
  const settings = value as TrimmingSettings
  if (typeof settings.enabled !== 'boolean' ||
    !Number.isFinite(settings.leadInSeconds) || settings.leadInSeconds < 0 || settings.leadInSeconds > 10 ||
    !Number.isFinite(settings.minimumIdleSeconds) || settings.minimumIdleSeconds < 1 || settings.minimumIdleSeconds > 60 ||
    !Number.isFinite(settings.keepIdleSeconds) || settings.keepIdleSeconds < 0.25 || settings.keepIdleSeconds >= settings.minimumIdleSeconds ||
    !Number.isFinite(settings.noiseDb) || settings.noiseDb < -100 || settings.noiseDb > -20 ||
    !Number.isInteger(settings.analysisWidth) || settings.analysisWidth < 128 || settings.analysisWidth > 1_920) {
    throw new Error('Invalid OpenScreen trimming settings: use a positive hold shorter than the idle threshold and bounded analysis parameters.')
  }
  return settings
}

/**
 * Coalesce source-time intervals so overlapping protections and cuts are applied once.
 */
export function mergeSpans(spans: TimeSpan[]): TimeSpan[] {
  const merged: TimeSpan[] = []
  for (const span of [...spans].sort((a, b) => a.startSec - b.startSec)) {
    if (!Number.isFinite(span.startSec) || !Number.isFinite(span.endSec) || span.endSec <= span.startSec) {
      continue
    }
    const previous = merged.at(-1)
    if (previous && span.startSec <= previous.endSec + TIME_EPSILON_SECONDS) {
      previous.endSec = Math.max(previous.endSec, span.endSec)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

/**
 * Remove protected or already-trimmed portions without shifting the source clock.
 */
export function subtractSpans(spans: TimeSpan[], exclusions: TimeSpan[]): TimeSpan[] {
  const remaining: TimeSpan[] = []
  const excluded = mergeSpans(exclusions)
  let index = 0

  for (const span of mergeSpans(spans)) {
    let startSec = span.startSec
    while (index < excluded.length && excluded[index]!.endSec <= startSec) {
      index++
    }
    while (index < excluded.length && excluded[index]!.startSec < span.endSec) {
      const cut = excluded[index]!
      if (cut.startSec > startSec) {
        remaining.push({ startSec, endSec: cut.startSec })
      }
      startSec = Math.max(startSec, cut.endSec)
      if (startSec >= span.endSec) {
        break
      }
      index++
    }
    if (startSec < span.endSec) {
      remaining.push({ startSec, endSec: span.endSec })
    }
  }
  return remaining
}

/**
 * Intersect sorted intervals without multiplying still and silent span counts.
 */
function intersectSpans(first: TimeSpan[], second: TimeSpan[]): TimeSpan[] {
  const left = mergeSpans(first)
  const right = mergeSpans(second)
  const intersection: TimeSpan[] = []
  let index = 0
  let otherIndex = 0

  while (index < left.length && otherIndex < right.length) {
    const a = left[index]!
    const b = right[otherIndex]!
    const startSec = Math.max(a.startSec, b.startSec)
    const endSec = Math.min(a.endSec, b.endSec)
    if (startSec < endSec) {
      intersection.push({ startSec, endSec })
    }
    if (a.endSec <= b.endSec) {
      index++
    } else {
      otherIndex++
    }
  }
  return intersection
}

/**
 * Retain typing, real cursor motion, zoom transitions and authored visual content.
 */
function protectedSpans(document: Record<string, unknown>, evidence: CaptureEvidence, cursor: CursorSample[]): TimeSpan[] {
  const spans = [...evidence.inputRanges]
  for (const [index, sample] of cursor.entries()) {
    const previous = cursor[index - 1]
    const interacting = sample.interactionType && !['move', 'position'].includes(sample.interactionType)
    const moved = previous && (sample.cx !== previous.cx || sample.cy !== previous.cy ||
      sample.visible !== previous.visible || sample.assetId !== previous.assetId)
    if (interacting || moved) {
      spans.push({ startSec: (moved ? previous.timeMs : sample.timeMs) / 1_000, endSec: sample.timeMs / 1_000 + TIME_EPSILON_SECONDS })
    }
  }
  const zooms = document['zoomRanges'] as Record<string, number>[]
  for (const zoom of zooms) {
    spans.push({ startSec: zoom['zoomInFromSec']!, endSec: zoom['startSec']! })
    spans.push({ startSec: zoom['endSec']!, endSec: zoom['panUntilSec'] ?? zoom['zoomOutUntilSec']! })
  }
  for (const key of ['annotations', 'effects', 'cameraFullscreenRegions']) {
    spans.push(...document[key] as TimeSpan[])
  }
  return mergeSpans(spans.map((span) => ({
    startSec: Math.max(0, span.startSec - ACTIVITY_PADDING_SECONDS),
    endSec: span.endSec + ACTIVITY_PADDING_SECONDS
  })))
}

/**
 * Propose only silent still footage outside observed activity and complete transitions.
 * Cuts are computed before subtracting existing trims, making repeated runs idempotent.
 */
export function planIdleTrims(
  document: Record<string, unknown>,
  evidence: CaptureEvidence,
  cursor: CursorSample[],
  analysis: MediaAnalysis,
  settings: TrimmingSettings
): TimeSpan[] {
  const protectedRanges = protectedSpans(document, evidence, cursor)
  const silentStill = intersectSpans(analysis.stillRanges, analysis.silentRanges)
  const eligible = subtractSpans(silentStill, protectedRanges)
  const proposed: TimeSpan[] = []
  const opening = eligible.find((span) => span.startSec <= TIME_EPSILON_SECONDS)
  if (opening) {
    // A complete zoom entrance is protected too, even when it precedes the first click.
    const endSec = Math.min(opening.endSec, evidence.firstInputSec) - settings.leadInSeconds
    if (endSec >= MINIMUM_CUT_SECONDS) {
      proposed.push({ startSec: 0, endSec })
    }
  }
  for (const span of eligible) {
    if (span !== opening && span.endSec - span.startSec >= settings.minimumIdleSeconds) {
      proposed.push({ startSec: span.startSec + settings.keepIdleSeconds / 2,
        endSec: span.endSec - settings.keepIdleSeconds / 2 })
    }
  }
  return subtractSpans(proposed, document['trimRanges'] as TimeSpan[])
    .filter((span) => span.endSec - span.startSec >= MINIMUM_CUT_SECONDS)
}
