import { useLayoutEffect, useRef, type RefObject } from 'react'

import {
  advanceCaretMotion,
  createCaretMotion,
  type CaretBounds,
  type CaretMotion
} from './input-effects-motion'
import {
  createTypingText,
  getTypingGrapheme,
  type TypingSelection
} from './typing-text'

import './input-effects.sass'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const CARET_WIDTH_EM = 0.5
const MAXIMUM_GLIDE_CHARACTERS = 8
const MIRROR_PROPERTIES = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
  'font-variant', 'font-kerning', 'font-feature-settings', 'font-variation-settings',
  'font-optical-sizing', 'letter-spacing', 'line-height', 'text-transform',
  'text-indent', 'text-align', 'direction', 'tab-size', 'word-spacing', 'word-break'
] as const

export type TextField = HTMLInputElement | HTMLTextAreaElement

interface InputEffectsProps {
  fieldRef: RefObject<TextField | null>
}

function measureCaret(
  mirror: HTMLElement,
  viewport: HTMLElement,
  field: TextField,
  caretWidth: number
): CaretBounds | null {
  const offset = field.selectionStart
  const textNode = mirror.firstChild

  if (offset === null || textNode === null) {
    return null
  }

  const visibleValue = field.value === '' ? field.placeholder : field.value
  const glyph = getTypingGrapheme(visibleValue, offset)
  const range = document.createRange()

  range.setStart(textNode, offset)
  range.collapse(true)

  let rect = range.getClientRects()[0]

  if (rect === undefined) {
    return null
  }

  let glyphWidth = 0

  if (glyph !== '' && glyph !== '\n') {
    range.setEnd(textNode, offset + glyph.length)

    const characterRect = range.getClientRects()[0]

    if (characterRect !== undefined) {
      // The glyph's box handles soft wraps and right-to-left runs without
      // inserting a measurement marker that could alter text shaping.
      rect = characterRect
      glyphWidth = characterRect.width
    }
  }

  const viewportRect = viewport.getBoundingClientRect()
  const scaleX = viewportRect.width / viewport.clientWidth || 1
  const scaleY = viewportRect.height / viewport.clientHeight || 1
  // Only a measured glyph defines a cell. An empty range may have a fractional
  // width; at line endings the virtual cell starts at the insertion point.
  const cellWidth = glyphWidth > 0 ? glyphWidth / scaleX : caretWidth

  return {
    x: (rect.left - viewportRect.left) / scaleX + (cellWidth - caretWidth) / 2,
    y: (rect.top - viewportRect.top) / scaleY,
    width: caretWidth,
    height: rect.height / scaleY
  }
}

/**
 * Adds a visual caret and fresh-character fade while native fields continue to
 * own editing, accessibility, selection, form submission and composition.
 */
export function InputEffects({ fieldRef }: InputEffectsProps) {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const mirrorRef = useRef<HTMLSpanElement>(null)
  const typingRef = useRef<HTMLSpanElement>(null)
  const caretRef = useRef<HTMLSpanElement>(null)
  const blockRef = useRef<HTMLSpanElement>(null)
  const placeholderInkRef = useRef<HTMLSpanElement>(null)
  const refreshRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    const field = fieldRef.current
    const viewport = viewportRef.current
    const mirror = mirrorRef.current
    const typing = typingRef.current
    const caret = caretRef.current
    const block = blockRef.current
    const placeholderInk = placeholderInkRef.current

    if (
      field === null || viewport === null || mirror === null || typing === null ||
      caret === null || block === null || placeholderInk === null
    ) {
      return
    }

    const nativeField = field
    const layer = viewport
    const text = mirror
    const typedText = typing
    const typingText = createTypingText(typedText)
    const caretLayer = caret
    const caretBlock = block
    const placeholderGlyph = placeholderInk
    const motionPreference = window.matchMedia(REDUCED_MOTION_QUERY)

    let selectionBeforeInput: TypingSelection | null = null
    let animateInput = false
    let composing = false
    let dragging = false
    let frame = 0
    let previousFrameTime = 0
    let target: CaretBounds | null = null
    let motion: CaretMotion | null = null
    let caretWidth = 0
    let observedWidth = nativeField.clientWidth
    let previousScrollLeft = nativeField.scrollLeft
    let previousScrollTop = nativeField.scrollTop

    function cancelMotion(): void {
      window.cancelAnimationFrame(frame)
      frame = 0
      target = null
      motion = null
      caretLayer.classList.remove('input-effects-moving')
    }

    function showNative(): void {
      nativeField.classList.remove('input-effects-active')
      nativeField.classList.remove('input-effects-native-caret')
      layer.hidden = true
      typingText.finish()
      placeholderGlyph.textContent = ''
      cancelMotion()
    }

    function draw(): void {
      if (motion === null) {
        return
      }

      const x = Math.min(...motion.corners.map((corner) => corner.x))
      const y = Math.min(...motion.corners.map((corner) => corner.y))
      const width = Math.max(...motion.corners.map((corner) => corner.x)) - x
      const height = Math.max(...motion.corners.map((corner) => corner.y)) - y
      const polygon = motion.corners.map((corner) =>
        `${corner.x - x}px ${corner.y - y}px`
      ).join(', ')

      caretBlock.style.left = `${x}px`
      caretBlock.style.top = `${y}px`
      caretBlock.style.width = `${width}px`
      caretBlock.style.height = `${height}px`
      caretBlock.style.clipPath = frame === 0 ? 'none' : `polygon(${polygon})`
      // Counter the block's motion so the placeholder's glyphs remain aligned
      // with the native placeholder, showing contrasting ink only inside it.
      placeholderGlyph.style.left = `${-x}px`
      placeholderGlyph.style.top = `${-y}px`
    }

    function animate(time: number): void {
      frame = 0

      if (target === null || motion === null) {
        return
      }

      const moving = advanceCaretMotion(motion, target, time - previousFrameTime)

      previousFrameTime = time

      if (moving) {
        frame = window.requestAnimationFrame(animate)
      } else {
        caretLayer.classList.remove('input-effects-moving')
      }

      draw()
    }

    function updateCaret(snap: boolean): void {
      if (
        composing || dragging ||
        nativeField.selectionStart !== nativeField.selectionEnd
      ) {
        cancelMotion()
        caretLayer.hidden = true
        nativeField.classList.add('input-effects-native-caret')
        return
      }

      const next = measureCaret(text, layer, nativeField, caretWidth)

      if (next === null || next.height === 0) {
        cancelMotion()
        caretLayer.hidden = true
        nativeField.classList.add('input-effects-native-caret')
        return
      }

      caretLayer.hidden = false
      nativeField.classList.remove('input-effects-native-caret')
      const firstCorner = motion?.corners[0]
      const maximumTravel = nativeField instanceof HTMLTextAreaElement
        ? Math.hypot(nativeField.clientWidth, nativeField.clientHeight)
        : caretWidth * MAXIMUM_GLIDE_CHARACTERS
      const jump = target === null || firstCorner === undefined ||
        Math.hypot(next.x - firstCorner.x, next.y - firstCorner.y) >
          maximumTravel
      const moved = target === null || next.x !== target.x || next.y !== target.y ||
        next.width !== target.width || next.height !== target.height

      if (target !== null && motion !== null) {
        const deltaX = next.x - target.x
        const deltaY = next.y - target.y
        const distance = Math.hypot(deltaX, deltaY)

        if (distance > 0) {
          motion.directionX = deltaX / distance
          motion.directionY = deltaY / distance
        }
      }

      target = next

      if (snap || jump) {
        window.cancelAnimationFrame(frame)
        frame = 0
        motion = createCaretMotion(next)
        caretLayer.classList.remove('input-effects-moving')
        draw()

        if (moved) {
          for (const animation of caretLayer.getAnimations()) {
            animation.currentTime = 0
          }
        }
      } else if (moved && frame === 0) {
        caretLayer.classList.add('input-effects-moving')
        previousFrameTime = performance.now()
        frame = window.requestAnimationFrame(animate)
      } else {
        draw()
      }
    }

    function updateLayout(): void {
      const style = window.getComputedStyle(nativeField)
      const fontSize = Number.parseFloat(style.fontSize)
      const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.2
      const paddingTop = Number.parseFloat(style.paddingTop)
      const paddingBottom = Number.parseFloat(style.paddingBottom)
      const isMultiline = nativeField instanceof HTMLTextAreaElement
      const scrollDeltaX = previousScrollLeft - nativeField.scrollLeft
      const scrollDeltaY = previousScrollTop - nativeField.scrollTop

      // Scrolling moves the whole text coordinate system. Carry the in-flight
      // shape with it so automatic textarea scrolling does not restart motion.
      if (motion !== null) {
        for (const corner of motion.corners) {
          corner.x += scrollDeltaX
          corner.y += scrollDeltaY
        }
      }

      if (target !== null) {
        target = {
          ...target,
          x: target.x + scrollDeltaX,
          y: target.y + scrollDeltaY
        }
      }

      previousScrollLeft = nativeField.scrollLeft
      previousScrollTop = nativeField.scrollTop

      for (const property of MIRROR_PROPERTIES) {
        text.style.setProperty(property, style.getPropertyValue(property))
      }

      caretWidth = fontSize * CARET_WIDTH_EM
      layer.style.setProperty('--input-caret-width', `${caretWidth}px`)
      layer.style.left = `${nativeField.offsetLeft + nativeField.clientLeft}px`
      layer.style.top = `${nativeField.offsetTop + nativeField.clientTop}px`
      layer.style.width = `${nativeField.clientWidth}px`
      layer.style.height = `${nativeField.clientHeight}px`
      text.style.width = `${nativeField.clientWidth}px`
      text.style.padding = style.padding
      text.style.whiteSpace = isMultiline && nativeField.wrap !== 'off'
        ? 'pre-wrap' : 'pre'
      text.style.overflowWrap = isMultiline && nativeField.wrap !== 'off'
        ? 'break-word' : 'normal'

      if (!isMultiline) {
        // Single-line native fields vertically center their text inside padding.
        text.style.paddingTop = `${paddingTop + Math.max(
          0,
          (nativeField.clientHeight - paddingTop - paddingBottom - lineHeight) / 2
        )}px`
      }

      text.style.transform = `translate(${-nativeField.scrollLeft}px, ${-nativeField.scrollTop}px)`
      typedText.style.cssText = text.style.cssText
      placeholderGlyph.style.cssText = text.style.cssText
    }

    function renderText(): void {
      const placeholder = nativeField.value === '' ? nativeField.placeholder : ''
      const measurement = `${nativeField.value || placeholder}\u200b`

      // Caret geometry always reads one plain text node. Animated glyphs never
      // influence its ranges, line wrapping or fallback decisions.
      if (text.textContent !== measurement) {
        text.textContent = measurement
      }

      placeholderGlyph.textContent = placeholder
      typingText.update(
        nativeField.value,
        animateInput && !composing,
        selectionBeforeInput
      )
    }

    function synchronize(snap = false): void {
      const canEnhance = document.activeElement === nativeField &&
        document.hasFocus() && !document.hidden && !motionPreference.matches &&
        !nativeField.disabled && !nativeField.readOnly &&
        nativeField.selectionStart !== null &&
        !(nativeField instanceof HTMLInputElement && nativeField.type === 'password')

      if (!canEnhance) {
        showNative()
        return
      }

      layer.hidden = false
      updateLayout()
      renderText()
      updateCaret(snap)

      if (!layer.hidden) {
        nativeField.classList.add('input-effects-active')
      }
    }

    function handleBeforeInput(event: Event): void {
      const inputEvent = event as InputEvent

      animateInput = inputEvent.inputType.startsWith('insert')
      selectionBeforeInput = nativeField.selectionStart === null ? null : {
        start: nativeField.selectionStart,
        end: nativeField.selectionEnd ?? nativeField.selectionStart
      }
    }

    function handleInput(event: Event): void {
      const inputEvent = event as InputEvent

      animateInput = inputEvent.inputType.startsWith('insert') &&
        !inputEvent.isComposing
      synchronize()
      animateInput = false
      selectionBeforeInput = null
    }

    function handleCompositionStart(): void {
      composing = true
      animateInput = false
      selectionBeforeInput = null
      synchronize()
    }

    function handleCompositionEnd(): void {
      composing = false
      synchronize(true)
    }

    function handlePointerDown(): void {
      dragging = true
      synchronize()
    }

    function handlePointerUp(): void {
      if (dragging) {
        dragging = false
        synchronize(true)
      }
    }

    function refresh(): void {
      synchronize()
    }

    function refreshLayout(): void {
      synchronize(true)
    }

    function handleResize(): void {
      const widthChanged = observedWidth !== nativeField.clientWidth

      observedWidth = nativeField.clientWidth

      // A growing composer must preserve the current line transition. Width
      // changes can reflow text; snap only when there is no motion to continue.
      synchronize(widthChanged && frame === 0)
    }

    function handleBlur(): void {
      dragging = false
      composing = false
      selectionBeforeInput = null
      animateInput = false
      showNative()
    }

    const resizeObserver = new ResizeObserver(handleResize)
    const fieldListeners = {
      focus: refreshLayout,
      blur: handleBlur,
      beforeinput: handleBeforeInput,
      input: handleInput,
      select: refresh,
      scroll: refresh,
      compositionstart: handleCompositionStart,
      compositionend: handleCompositionEnd,
      pointerdown: handlePointerDown
    }

    for (const [event, listener] of Object.entries(fieldListeners)) {
      nativeField.addEventListener(event, listener)
    }

    document.addEventListener('selectionchange', refresh)
    document.addEventListener('visibilitychange', refreshLayout)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerUp)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', refreshLayout)
    document.fonts.addEventListener('loadingdone', refreshLayout)
    motionPreference.addEventListener('change', refreshLayout)
    resizeObserver.observe(nativeField)
    refreshRef.current = refresh
    synchronize(true)

    return () => {
      refreshRef.current = null
      showNative()
      typingText.dispose()
      resizeObserver.disconnect()

      for (const [event, listener] of Object.entries(fieldListeners)) {
        nativeField.removeEventListener(event, listener)
      }

      document.removeEventListener('selectionchange', refresh)
      document.removeEventListener('visibilitychange', refreshLayout)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointercancel', handlePointerUp)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', refreshLayout)
      document.fonts.removeEventListener('loadingdone', refreshLayout)
      motionPreference.removeEventListener('change', refreshLayout)
    }
  }, [fieldRef])

  useLayoutEffect(() => {
    // Controlled values, resets and composer height changes settle after render.
    refreshRef.current?.()
  })

  return (
    <span ref={viewportRef} className="input-effects" aria-hidden="true" hidden>
      <span className="input-effects-text-viewport">
        <span ref={mirrorRef} className="input-effects-measurement" />
        <span ref={typingRef} className="input-effects-text" />
      </span>
      <span ref={caretRef} className="input-effects-caret">
        <span ref={blockRef} className="input-effects-block">
          <span ref={placeholderInkRef} className="input-effects-placeholder-ink" />
        </span>
      </span>
    </span>
  )
}
