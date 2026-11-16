import { getStoredSoundsEnabled } from '@/theme'
import { getPublicAssetPath } from '@/config'

export const COMPLETION_SOUND = {
  label: 'Turn complete', file: 'sounds/turn-complete.wav'
} as const

const VOLUME = 0.45
const MAXIMUM_SOUND_DELAY_MS = 250
const SOUND_STORAGE_PREFIX = 'leon.web-app.sound-receipts.'
let sample: Promise<AudioBuffer | undefined> | undefined
let context: AudioContext | undefined

function loadSample(): Promise<AudioBuffer | undefined> {
  const audio = context
  if (!audio) {
    return Promise.resolve(undefined)
  }
  if (!sample) {
    sample = fetch(getPublicAssetPath(COMPLETION_SOUND.file))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('The sound asset is unavailable.')
        }

        return audio.decodeAudioData(await response.arrayBuffer())
      }).catch(() => {
        sample = undefined
        return undefined
      })
  }

  return sample
}

/**
 * Opens a shared audio context from owner gestures and warms the completion
 * sample. Suspended playback never builds a queue of old notifications.
 */
export function unlockSounds(): void {
  if (!getStoredSoundsEnabled()) {
    return
  }
  try {
    if (!context) {
      context = new AudioContext()
      void loadSample()
    }
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined)
    }
  } catch {
    // Audio is best effort, including browser autoplay and device restrictions.
  }
}

function canPlay(startedAt: number): boolean {
  return getStoredSoundsEnabled() && context?.state === 'running'
    && performance.now() - startedAt <= MAXIMUM_SOUND_DELAY_MS
}

function play(buffer: AudioBuffer): void {
  const audio = context!
  const source = audio.createBufferSource()
  const gain = audio.createGain()
  source.buffer = buffer
  gain.gain.value = VOLUME
  source.connect(gain)
  gain.connect(audio.destination)
  source.onended = (): void => {
    source.disconnect()
    gain.disconnect()
  }
  source.start()
}

/**
 * Previews the completion cue after an explicit owner interaction.
 */
export function previewCompletionSound(): void {
  const startedAt = performance.now()
  unlockSounds()
  void loadSample().then((buffer) => {
    if (buffer && canPlay(startedAt)) {
      play(buffer)
    }
  }).catch(() => undefined)
}

/**
 * Shared receipts prevent duplicate cues for replay, retries and multiple tabs.
 * Silent tabs never claim a cue that an audible tab could deliver.
 */
export function playTurnCompletionSound(profile: string, sequence: number): void {
  if (!getStoredSoundsEnabled() || context?.state !== 'running') {
    return
  }
  const key = `${SOUND_STORAGE_PREFIX}${profile}`
  const startedAt = performance.now()
  const deliver = (buffer: AudioBuffer): void => {
    if (!canPlay(startedAt)) {
      return
    }
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as { cursor?: number }
      const cursor = Number.isSafeInteger(stored.cursor) ? stored.cursor! : 0
      if (sequence <= cursor) {
        return
      }
      localStorage.setItem(key, JSON.stringify({ cursor: sequence }))
      play(buffer)
    } catch {
      // Blocked storage keeps cues silent rather than replaying every completion.
    }
  }
  void loadSample().then((buffer) => {
    if (!buffer) {
      return
    }
    if (navigator.locks) {
      void navigator.locks.request(key, () => deliver(buffer)).catch(() => undefined)
    } else {
      deliver(buffer)
    }
  }).catch(() => undefined)
}
