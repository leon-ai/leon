export const TYPING_FADE_DURATION_MS = 1_000

const TYPING_INITIAL_OPACITY = 0.15
const TYPING_INITIAL_COLOR = `color-mix(in srgb, var(--color-text) ${TYPING_INITIAL_OPACITY * 100}%, transparent)`
const TYPING_FINAL_COLOR = 'var(--color-text)'
const TYPING_EASING = 'ease-out'
const MAXIMUM_ANIMATED_INSERT_LENGTH = 64
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

interface TypingCharacter {
  value: string
  element: HTMLSpanElement | null
  animation: Animation | null
}

export interface TypingSelection {
  start: number
  end: number
}

interface TypingText {
  update: (
    value: string,
    animate: boolean,
    selection?: TypingSelection | null
  ) => void
  finish: () => void
  dispose: () => void
}

/**
 * Returns one complete visible character at a native selection offset.
 */
export function getTypingGrapheme(value: string, offset: number): string {
  return segmenter.segment(value.slice(offset))[Symbol.iterator]()
    .next().value?.segment ?? ''
}

/**
 * Owns the visible text independently of caret measurement. Existing letters
 * retain their elements and browser animations as new text is inserted.
 */
export function createTypingText(element: HTMLElement): TypingText {
  let value = ''
  let characters: TypingCharacter[] = []
  let disposed = false

  function render(): void {
    if (disposed) {
      return
    }

    const nodes: Node[] = []
    let plainText = ''

    for (const character of characters) {
      if (character.element === null) {
        plainText += character.value
        continue
      }

      if (plainText !== '') {
        nodes.push(document.createTextNode(plainText))
        plainText = ''
      }

      nodes.push(character.element)
    }

    nodes.push(document.createTextNode(plainText))

    const retained = new Set(nodes)

    for (const node of Array.from(element.childNodes)) {
      if (!retained.has(node)) {
        element.removeChild(node)
      }
    }

    let cursor = element.firstChild

    for (const node of nodes) {
      if (node === cursor) {
        cursor = cursor.nextSibling
      } else {
        element.insertBefore(node, cursor)
      }
    }

    for (const character of characters) {
      if (character.element === null || character.animation !== null) {
        continue
      }

      // Animate glyph paint rather than inline box opacity so word shaping and
      // whitespace do not depend on compositing a separate box for each letter.
      const animation = character.element.animate([
        { color: TYPING_INITIAL_COLOR },
        { color: TYPING_FINAL_COLOR }
      ], {
        duration: TYPING_FADE_DURATION_MS,
        easing: TYPING_EASING,
        fill: 'both'
      })

      character.animation = animation
      animation.onfinish = (): void => {
        if (disposed || character.animation !== animation) {
          return
        }

        character.animation = null
        character.element = null
        animation.cancel()
        render()
      }
    }
  }

  function finish(): void {
    for (const character of characters) {
      const animation = character.animation

      character.animation = null
      character.element = null
      animation?.cancel()
    }

    render()
  }

  function update(
    nextValue: string,
    animate: boolean,
    selection: TypingSelection | null = null
  ): void {
    if (disposed || nextValue === value) {
      return
    }

    const next = Array.from(segmenter.segment(nextValue), ({ segment }) => segment)
    let prefix = 0
    let previousEnd = characters.length
    let nextEnd = next.length

    // Word commits may report a caret inside the replaced word. Only use that
    // position when the resulting value actually describes an insertion there.
    let prefixLimit = characters.length
    const insertedLength = nextValue.length - value.length
    const isAnchoredInsertion = selection !== null &&
      selection.start === selection.end && insertedLength >= 0 &&
      nextValue.slice(0, selection.start) === value.slice(0, selection.start) &&
      nextValue.slice(selection.start + insertedLength) === value.slice(selection.end)

    if (isAnchoredInsertion && selection !== null) {
      let offset = 0

      prefixLimit = 0

      for (const character of characters) {
        if (offset >= selection.start) {
          break
        }

        offset += character.value.length
        prefixLimit += 1
      }
    }

    while (
      prefix < prefixLimit && prefix < nextEnd &&
      characters[prefix]?.value === next[prefix]
    ) {
      prefix += 1
    }

    while (
      previousEnd > prefix && nextEnd > prefix &&
      characters[previousEnd - 1]?.value === next[nextEnd - 1]
    ) {
      previousEnd -= 1
      nextEnd -= 1
    }

    for (const character of characters.slice(prefix, previousEnd)) {
      character.animation?.cancel()
      character.animation = null
    }

    const shouldAnimate = animate &&
      nextEnd - prefix <= MAXIMUM_ANIMATED_INSERT_LENGTH
    const inserted = next.slice(prefix, nextEnd).map((character) => {
      const span = shouldAnimate ? document.createElement('span') : null

      if (span !== null) {
        span.textContent = character
        span.style.color = TYPING_INITIAL_COLOR
      }

      return { value: character, element: span, animation: null }
    })

    characters = [
      ...characters.slice(0, prefix),
      ...inserted,
      ...characters.slice(previousEnd)
    ]
    value = nextValue
    render()
  }

  function dispose(): void {
    disposed = true
    finish()
    characters = []
    element.replaceChildren()
  }

  return { update, finish, dispose }
}
