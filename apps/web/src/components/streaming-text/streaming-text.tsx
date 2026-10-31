import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode
} from 'react'

import './streaming-text.sass'

const CHARACTER_STAGGER_MS = 7
const CHARACTER_REVEAL_DURATION_MS = 420
const MAXIMUM_BATCH_CHARACTERS = 128
const MAXIMUM_PENDING_CHARACTERS = 1_024
const MAXIMUM_LIVE_STAGGER_MS = 120

interface CharacterReveal {
  delay: number
  completesAt: number
}

interface StreamingTextProps {
  animationId: string
  animateInitial?: boolean
  className?: string
  startDelay?: number
  text: string
}

interface StreamingTextState {
  animationId: string
  reveals: Map<number, CharacterReveal>
  text: string
}

interface FeedAnimationProviderProps {
  children: ReactNode
  historicalIds?: readonly string[]
  live?: boolean
}

interface FeedAnimationRegistry {
  startedAnimationIds: Set<string>
  streamedCharacterCounts: Map<string, number>
  historicalIds: readonly string[]
  live: boolean
}

const FeedAnimationContext = createContext<FeedAnimationRegistry | null>(null)

export function FeedAnimationProvider({
  children,
  historicalIds = [],
  live = false
}: FeedAnimationProviderProps) {
  const registryRef = useRef<FeedAnimationRegistry>({
    startedAnimationIds: new Set(),
    streamedCharacterCounts: new Map(),
    historicalIds,
    live
  })
  registryRef.current.historicalIds = historicalIds
  registryRef.current.live = live

  return (
    <FeedAnimationContext.Provider value={registryRef.current}>
      {children}
    </FeedAnimationContext.Provider>
  )
}

/**
 * Claims a one-time feed animation while preserving that claim across
 * virtualized unmounts.
 */
export function useAnimateOnce(animationId: string): boolean {
  const registry = useContext(FeedAnimationContext)
  const stateRef = useRef({
    animationId,
    shouldAnimate: !(registry?.startedAnimationIds.has(animationId) ?? false)
  })

  if (stateRef.current.animationId !== animationId) {
    stateRef.current = {
      animationId,
      shouldAnimate: !(registry?.startedAnimationIds.has(animationId) ?? false)
    }
  }

  useLayoutEffect(() => {
    registry?.startedAnimationIds.add(animationId)
  }, [animationId, registry])

  return stateRef.current.shouldAnimate &&
    !(registry?.historicalIds.some((id) => animationId.startsWith(id)) ?? false)
}

export function StreamingText({
  animationId,
  animateInitial = true,
  className,
  startDelay = 0,
  text
}: StreamingTextProps) {
  const registry = useContext(FeedAnimationContext)
  const stateRef = useRef<StreamingTextState>({
    animationId,
    reveals: new Map(),
    // Cached labels should appear immediately and only reveal subsequent changes.
    text: animateInitial ? '' : text
  })
  const characters = Array.from(text)

  if (
    stateRef.current.animationId !== animationId ||
    stateRef.current.text !== text
  ) {
    const isSameAnimation = stateRef.current.animationId === animationId
    const continuesText = isSameAnimation && text.startsWith(stateRef.current.text)
    const previousCharacterCount = continuesText
      ? registry?.streamedCharacterCounts.get(animationId) ?? Array.from(stateRef.current.text).length
      : 0
    const now = performance.now()
    const batchStart = Math.max(previousCharacterCount, characters.length - MAXIMUM_BATCH_CHARACTERS)
    const reveals = new Map<number, CharacterReveal>()

    if (continuesText) {
      for (const [index, reveal] of stateRef.current.reveals) {
        // A sliding character window must not remove a still-fading DOM node.
        // Settled text is compacted on subsequent chunks, without timers.
        if (reveal.completesAt > now || index >= characters.length - MAXIMUM_BATCH_CHARACTERS) {
          reveals.set(index, reveal)
        }
      }
    }

    const batchSize = characters.length - batchStart
    const stagger = registry?.live
      ? Math.min(CHARACTER_STAGGER_MS, MAXIMUM_LIVE_STAGGER_MS / Math.max(1, batchSize - 1))
      : CHARACTER_STAGGER_MS

    // Keep pathological bursts readable without creating unbounded character DOM.
    // Existing reveals keep their slots; excess text is rendered normally.
    for (let index = batchStart; index < characters.length && reveals.size < MAXIMUM_PENDING_CHARACTERS; index++) {
      const delay = (registry?.live ? 0 : startDelay) + (index - batchStart) * stagger
      reveals.set(index, { delay, completesAt: now + delay + CHARACTER_REVEAL_DURATION_MS })
    }

    stateRef.current = {
      animationId,
      reveals,
      text
    }
  }

  useLayoutEffect(() => {
    if (registry === null) {
      return
    }

    registry.streamedCharacterCounts.set(animationId, characters.length)
  }, [animationId, characters.length, registry])

  if (registry?.historicalIds.some((id) => animationId.startsWith(id))) {
    return (
      <span className={className}>
        <span className="streaming-text-characters">{text}</span>
      </span>
    )
  }
  const content: ReactNode[] = []
  let cursor = 0

  for (const [index, reveal] of stateRef.current.reveals) {
    if (index > cursor) {
      content.push(characters.slice(cursor, index).join(''))
    }

    content.push(
      <span
        key={`${animationId}:${index}-${characters[index]}`}
        className="streaming-text-character-new"
        style={{ animationDelay: `${reveal.delay}ms` }}
      >
        {characters[index]}
      </span>
    )
    cursor = index + 1
  }

  content.push(characters.slice(cursor).join(''))

  return (
    <span
      className={className}
      aria-label={text}
      style={{ '--streaming-text-duration': `${CHARACTER_REVEAL_DURATION_MS}ms` } as CSSProperties}
    >
      <span className="streaming-text-characters" aria-hidden="true">
        {content}
      </span>
    </span>
  )
}
