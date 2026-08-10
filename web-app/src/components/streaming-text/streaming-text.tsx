import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode
} from 'react'

import './streaming-text.sass'

const CHARACTER_STAGGER_MS = 7

interface StreamingTextProps {
  animationId: string
  className?: string
  startDelay?: number
  text: string
}

interface StreamingTextState {
  animationId: string
  firstNewCharacterIndex: number
  text: string
}

interface FeedAnimationProviderProps {
  children: ReactNode
}

interface FeedAnimationRegistry {
  startedAnimationIds: Set<string>
  streamedCharacterCounts: Map<string, number>
}

const FeedAnimationContext = createContext<FeedAnimationRegistry | null>(null)

export function FeedAnimationProvider({
  children
}: FeedAnimationProviderProps) {
  const registryRef = useRef<FeedAnimationRegistry>({
    startedAnimationIds: new Set(),
    streamedCharacterCounts: new Map()
  })

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

  return stateRef.current.shouldAnimate
}

export function StreamingText({
  animationId,
  className,
  startDelay = 0,
  text
}: StreamingTextProps) {
  const registry = useContext(FeedAnimationContext)
  const stateRef = useRef<StreamingTextState>({
    animationId,
    firstNewCharacterIndex: 0,
    text: ''
  })
  const characters = Array.from(text)

  if (
    stateRef.current.animationId !== animationId ||
    stateRef.current.text !== text
  ) {
    const isSameAnimation = stateRef.current.animationId === animationId
    const previousCharacterCount =
      registry?.streamedCharacterCounts.get(animationId) ?? (
      isSameAnimation && text.startsWith(stateRef.current.text)
        ? Array.from(stateRef.current.text).length
        : 0
    )

    stateRef.current = {
      animationId,
      firstNewCharacterIndex: Math.min(
        previousCharacterCount,
        characters.length
      ),
      text
    }
  }

  const { firstNewCharacterIndex } = stateRef.current

  useLayoutEffect(() => {
    if (registry === null) {
      return
    }

    const previousCharacterCount =
      registry.streamedCharacterCounts.get(animationId) ?? 0
    registry.streamedCharacterCounts.set(
      animationId,
      Math.max(previousCharacterCount, characters.length)
    )
  }, [animationId, characters.length, registry])

  return (
    <span className={className} aria-label={text}>
      <span className="streaming-text-characters" aria-hidden="true">
        {characters.map((character, index) => {
          const isNewCharacter = index >= firstNewCharacterIndex
          const delay = startDelay +
            (Math.max(0, index - firstNewCharacterIndex) * CHARACTER_STAGGER_MS)

          return (
            <span
              key={`${index}-${character}`}
              className={isNewCharacter
                ? 'streaming-text-character-new'
                : 'streaming-text-character-visible'}
              style={isNewCharacter ? { animationDelay: `${delay}ms` } : undefined}
            >
              {character}
            </span>
          )
        })}
      </span>
    </span>
  )
}
