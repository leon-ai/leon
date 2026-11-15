import { clsx } from 'clsx'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent,
  type KeyboardEvent
} from 'react'

import { Button } from '@/components/button'
import { observeAnimationVisibility } from '@/utils/animation-visibility'
import { Input } from '@/components/input'
import { ModelSelector } from '@/components/model-selector'
import type { useComposerModel } from '@/data/composer-model'
import { useComposerDraft } from '@/data/composer-draft'
import { useQueryHistory } from '@/data/query-history'

import { QueryInputFocusWave } from './query-input-focus-wave'
import { AttachmentPreviews } from './attachment-previews'
import { useComposerAttachments } from './use-composer-attachments'
import type { ComposerAttachment } from './use-composer-attachments'
import type { AttachmentUploadListener } from '@/data/owner-attachments'
import { VisualPreviewProvider } from '@/components/visual-preview/visual-preview'

import './query-input.sass'

const DEFAULT_PLACEHOLDER = 'Don’t be shy'
const DEFAULT_MAXIMUM_LINE_COUNT = 12
const PARTICLE_COUNT = 14
const DECORATION_ACTIVITY_MS = 6_000
const HEIGHT_COMPARISON_TOLERANCE = 1
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

interface QueryInputProps {
  sessionId?: string
  autoFocus?: boolean
  autoFocusKey?: string
  introWave?: boolean
  disabled?: boolean
  canSubmit?: boolean
  loading?: boolean
  failed?: boolean
  maximumLineCount?: number
  placeholder?: string
  onSubmit?: (query: string, attachments: ComposerAttachment[], onUploadProgress: AttachmentUploadListener, signal: AbortSignal) => void | Promise<unknown>
  model?: ReturnType<typeof useComposerModel>
  onStop?: () => void
}

export function QueryInput({
  sessionId,
  autoFocus = false,
  autoFocusKey,
  introWave = false,
  disabled = false,
  canSubmit = true,
  loading = false,
  failed = false,
  maximumLineCount = DEFAULT_MAXIMUM_LINE_COUNT,
  placeholder = DEFAULT_PLACEHOLDER,
  onSubmit,
  model,
  onStop
}: QueryInputProps) {
  const [query, setQuery, draftRestoration] = useComposerDraft(sessionId)
  const [submitting, setSubmitting] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const attachmentsRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const submissionRef = useRef<AbortController | undefined>(undefined)
  const attachments = useComposerAttachments(containerRef, disabled || loading || submitting)
  const caretRestorationRef = useRef<number | undefined>(undefined)
  const [settledRestoration, setSettledRestoration] = useState<number | undefined>(undefined)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isScrollable, setIsScrollable] = useState(false)
  const [showFocusWave, setShowFocusWave] = useState(() => introWave &&
    !window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches)
  const [focusWaveKey, setFocusWaveKey] = useState(0)
  const [formHeight, setFormHeight] = useState<number>()
  const actionsRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const leadingActionRef = useRef<HTMLDivElement>(null)
  const measurementTextareaRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const keyboardFocusIntentRef = useRef(false)
  const history = useQueryHistory(sessionId)
  const historyIndexRef = useRef(-1)
  const historyRequestRef = useRef(0)
  const historyPendingRef = useRef(false)
  const historySelectionRef = useRef(false)
  const normalizedQuery = query.trim()
  const busy = loading || submitting
  const submitDisabled = disabled || busy || attachments.reading || !canSubmit || normalizedQuery.length === 0 && attachments.items.length === 0
  const resolvedMaximumLineCount = Math.max(1, maximumLineCount)

  useEffect(() => {
    const container = containerRef.current

    if (container === null) {
      return undefined
    }

    const surface = container
    let canAnimate = false
    let idleTimer = 0

    function settle(): void {
      window.clearTimeout(idleTimer)
      surface.classList.remove('query-input-active')
    }

    function activate(): void {
      if (!canAnimate) {
        return
      }

      window.clearTimeout(idleTimer)
      surface.classList.add('query-input-active')
      idleTimer = window.setTimeout(settle, DECORATION_ACTIVITY_MS)
    }

    const unobserve = observeAnimationVisibility(surface, (running) => {
      canAnimate = running
      surface.classList.toggle('query-input-visible', running)
      if (!running) {
        settle()
      }
    })

    // The blurred glow pulses around input; visible particles keep their rhythm.
    surface.addEventListener('input', activate)
    surface.addEventListener('focusin', activate)
    surface.addEventListener('pointerdown', activate)

    return () => {
      unobserve()
      settle()
      surface.removeEventListener('input', activate)
      surface.removeEventListener('focusin', activate)
      surface.removeEventListener('pointerdown', activate)
    }
  }, [])

  useEffect(() => () => submissionRef.current?.abort(), [])

  useLayoutEffect(() => {
    if (autoFocus && !disabled && !loading) {
      // Navigation should focus drafting without moving the conversation viewport.
      keyboardFocusIntentRef.current = false
      textareaRef.current?.focus({ preventScroll: true })
    }
  }, [autoFocus, autoFocusKey, disabled, loading])

  const playFocusWave = useCallback((): void => {
    if (disabled || loading || window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches) {
      return
    }
    setFocusWaveKey((current) => current + 1)
    setShowFocusWave(true)
  }, [disabled, loading])

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      keyboardFocusIntentRef.current = event.isTrusted && event.key === 'Tab'
    }

    function clearFocusIntent(): void {
      keyboardFocusIntentRef.current = false
    }

    function handleFocus(event: FocusEvent): void {
      const keyboardIntent = keyboardFocusIntentRef.current
      clearFocusIntent()
      if (keyboardIntent && event.target === textareaRef.current) {
        playFocusWave()
      }
    }

    function handleWindowBlur(): void {
      clearFocusIntent()
      setShowFocusWave(false)
    }

    // Focus events alone also include autofocus and browser-tab restoration.
    // Consume keyboard intent at its next focus target; pointer focus is local.
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', handleFocus, true)
    document.addEventListener('pointerdown', clearFocusIntent, true)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', handleFocus, true)
      document.removeEventListener('pointerdown', clearFocusIntent, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [playFocusWave])

  const updateTextareaHeight = useCallback((): void => {
    const textarea = textareaRef.current
    const form = formRef.current
    const leadingAction = leadingActionRef.current
    const actions = actionsRef.current
    const measurementTextarea = measurementTextareaRef.current

    if (
      textarea === null ||
      form === null ||
      leadingAction === null ||
      actions === null ||
      measurementTextarea === null
    ) {
      return
    }

    const textareaStyle = window.getComputedStyle(textarea)
    const formStyle = window.getComputedStyle(form)
    const lineHeight = Number.parseFloat(textareaStyle.lineHeight)
    const verticalPadding =
      Number.parseFloat(textareaStyle.paddingTop) +
      Number.parseFloat(textareaStyle.paddingBottom)
    const verticalBorder =
      Number.parseFloat(textareaStyle.borderTopWidth) +
      Number.parseFloat(textareaStyle.borderBottomWidth)
    const singleLineHeight = lineHeight + verticalPadding + verticalBorder
    const actionRowHeight = Math.max(leadingAction.offsetHeight, actions.offsetHeight)
    const attachmentHeight = attachmentsRef.current?.offsetHeight ?? 0
    // Leave room for the conversation even on short viewports; longer drafts
    // scroll inside the native textarea instead of covering the entire feed.
    const viewportMaximum = window.innerHeight / 2 -
      verticalPadding - actionRowHeight - lineHeight - attachmentHeight
    const maximumHeight = Math.max(singleLineHeight,
      Math.min(lineHeight * resolvedMaximumLineCount + verticalPadding + verticalBorder, viewportMaximum))
    const horizontalFormPadding =
      Number.parseFloat(formStyle.paddingLeft) +
      Number.parseFloat(formStyle.paddingRight)
    const verticalFormPadding =
      Number.parseFloat(formStyle.paddingTop) +
      Number.parseFloat(formStyle.paddingBottom)
    const verticalFormBorder =
      Number.parseFloat(formStyle.borderTopWidth) +
      Number.parseFloat(formStyle.borderBottomWidth)
    const gap = Number.parseFloat(
      formStyle.getPropertyValue('--query-input-action-gap')
    )
    const expandedFieldWidth = Math.max(
      1,
      form.clientWidth - horizontalFormPadding
    )
    const inlineFieldWidth = Math.max(
      1,
      expandedFieldWidth -
      leadingAction.offsetWidth -
      actions.offsetWidth -
      (gap * 2)
    )
    form.style.setProperty('--query-input-actions-width', `${actions.offsetWidth}px`)
    measurementTextarea.style.width = `${inlineFieldWidth}px`

    const inlineContentHeight =
      measurementTextarea.scrollHeight + verticalBorder
    const shouldExpand =
      attachmentHeight > 0 || inlineContentHeight > singleLineHeight + HEIGHT_COMPARISON_TOLERANCE

    measurementTextarea.style.width = `${
      shouldExpand ? expandedFieldWidth : inlineFieldWidth
    }px`

    const contentHeight = measurementTextarea.scrollHeight + verticalBorder
    const minimumExpandedHeight =
      (lineHeight * (attachmentHeight ? 1 : 2)) + verticalPadding + verticalBorder
    const nextHeight = Math.min(
      Math.max(contentHeight, shouldExpand ? minimumExpandedHeight : 0),
      maximumHeight
    )

    // Only the hidden measurement field is resized while calculating layout,
    // so the visible text remains stable as the composer transition begins.
    textarea.style.height = `${nextHeight}px`

    if (contentHeight <= maximumHeight) {
      // Native newline insertion can scroll a one-line textarea before React
      // applies its new height, which makes the text briefly jump upward.
      textarea.scrollTop = 0
    }

    const contentAreaHeight = shouldExpand
      ? nextHeight + gap + actionRowHeight
      : Math.max(nextHeight, actionRowHeight)
    const minimumFormHeight = Number.parseFloat(formStyle.minHeight)

    setFormHeight(Math.max(
      minimumFormHeight,
      attachmentHeight + contentAreaHeight + verticalFormPadding + verticalFormBorder
    ))
    setIsExpanded(shouldExpand)
    setIsScrollable(
      contentHeight > maximumHeight + HEIGHT_COMPARISON_TOLERANCE
    )
  }, [resolvedMaximumLineCount])

  useLayoutEffect(() => {
    updateTextareaHeight()
    if (historySelectionRef.current || caretRestorationRef.current !== draftRestoration) {
      caretRestorationRef.current = draftRestoration
      historySelectionRef.current = false
      textareaRef.current?.setSelectionRange(query.length, query.length)
    }
    if (settledRestoration !== draftRestoration) {
      // Commit the measured draft geometry with transitions disabled. Ordinary
      // editing regains its existing motion after this restoration frame.
      const frame = window.requestAnimationFrame(() => setSettledRestoration(draftRestoration))
      return () => window.cancelAnimationFrame(frame)
    }

    return undefined
  }, [query, attachments.items, draftRestoration, settledRestoration, updateTextareaHeight])

  useEffect(() => () => {
    // An obsolete network response must never replace another session's input.
    historyRequestRef.current += 1
  }, [])

  useLayoutEffect(() => {
    const actions = actionsRef.current

    if (actions === null) {
      return
    }

    // A different model label changes the inline space available to the text.
    const observer = new ResizeObserver(updateTextareaHeight)

    observer.observe(actions)

    return () => observer.disconnect()
  }, [updateTextareaHeight])

  useLayoutEffect(() => {
    const form = formRef.current

    if (form === null) {
      return
    }

    let previousWidth = form.getBoundingClientRect().width
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry === undefined) {
        return
      }

      const currentWidth = entry.contentRect.width

      // Recalculate wrapping when the available page width changes without
      // reacting again to height changes caused by the textarea itself.
      if (Math.abs(currentWidth - previousWidth) <= HEIGHT_COMPARISON_TOLERANCE) {
        return
      }

      previousWidth = currentWidth
      updateTextareaHeight()
    })

    resizeObserver.observe(form)
    window.addEventListener('resize', updateTextareaHeight)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateTextareaHeight)
    }
  }, [updateTextareaHeight])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (submitDisabled || busy) {
      return
    }

    resetHistoryNavigation()
    setSubmitting(true)
    attachments.queueUploads()
    const submission = new AbortController()
    submissionRef.current = submission
    try {
      await onSubmit?.(normalizedQuery, attachments.items, attachments.updateUpload, submission.signal)
      submission.signal.throwIfAborted()
      setQuery('')
      attachments.clear()
      textareaRef.current?.focus({ preventScroll: true })
    } catch {
      // The shared mutation cache reports delivery errors. Keep the draft and
      // files available so the owner can retry without selecting them again.
    } finally {
      if (!submission.signal.aborted) {
        setSubmitting(false)
      }
    }
  }

  function resetHistoryNavigation(): void {
    historyIndexRef.current = -1
    historyRequestRef.current += 1
    historyPendingRef.current = false
    historySelectionRef.current = false
  }

  function handleAttachmentSelection(event: ChangeEvent<HTMLInputElement>): void {
    if (event.target.files) {
      attachments.add(event.target.files)
    }
    event.target.value = ''
    textareaRef.current?.focus({ preventScroll: true })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing || busy) {
      return
    }

    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && sessionId) {
      const start = historyIndexRef.current === -1
      if (start && query !== '') {
        return
      }

      event.preventDefault()
      if (event.key === 'ArrowUp' && historyPendingRef.current) {
        return
      }

      const index = historyIndexRef.current + (event.key === 'ArrowUp' ? 1 : -1)
      if (index < 0) {
        resetHistoryNavigation()
        setQuery('')
        return
      }

      const request = ++historyRequestRef.current
      historyPendingRef.current = true
      void history.read(index, start).then((message) => {
        if (historyRequestRef.current !== request || message === undefined) {
          return
        }

        historyIndexRef.current = index
        historySelectionRef.current = true
        setQuery(message)
      }).catch(() => {
        // The shared query cache reports failures through the toast component.
      }).finally(() => {
        if (historyRequestRef.current === request) {
          historyPendingRef.current = false
        }
      })
      return
    }

    if (
      event.key !== 'Enter' ||
      event.shiftKey
    ) {
      return
    }

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <VisualPreviewProvider>
      <div ref={containerRef} className="query-input-container">
        {attachments.dropZone}
        <div className="query-input-glow" aria-hidden="true" />
        <div className="query-input-particles" aria-hidden="true">
          {Array.from({ length: PARTICLE_COUNT }, (_, index) => (
            <span key={index} className="query-input-particle" />
          ))}
        </div>
        <form
          ref={formRef}
          className={clsx('query-input', {
            'query-input-expanded': isExpanded,
            'query-input-restoring': settledRestoration !== draftRestoration
          })}
          aria-label="Send a message to Leon"
          style={formHeight === undefined ? undefined : {
            height: `${formHeight}px`
          }}
          onSubmit={handleSubmit}
          onPaste={(event) => {
            if (event.clipboardData.files.length) {
              event.preventDefault()
              attachments.add(event.clipboardData.files)
            }
          }}
        >
          <input ref={fileInputRef} type="file" multiple hidden
            aria-label="Choose attachments" disabled={disabled || busy}
            onChange={handleAttachmentSelection} />
          {attachments.items.length > 0 && <div ref={attachmentsRef}>
            <AttachmentPreviews items={attachments.items} uploads={attachments.uploads} disabled={disabled || busy} onRemove={attachments.remove} />
          </div>}
          <div ref={leadingActionRef} className="query-input-leading-action">
            <Button
              className="button-composer query-input-add"
              iconName="add-large"
              tooltipMessage="Add files"
              tooltipPosition="top"
              disabled={disabled || busy}
              onClick={() => fileInputRef.current?.click()}
            />
          </div>
          <Input
            ariaLabel="Message Leon"
            className={clsx('query-input-field', {
              'query-input-field-scrollable': isScrollable
            })}
            fieldRef={textareaRef}
            variant="embedded"
            multiline
            rows={1}
            name="query"
            placeholder={placeholder}
            value={query}
            autoComplete="off"
            disabled={disabled || loading}
            readOnly={submitting}
            onPointerDown={(event) => {
              if (event.isTrusted && event.button === 0 && document.activeElement !== event.currentTarget) {
                playFocusWave()
              }
            }}
            onChange={(event) => {
              resetHistoryNavigation()
              setQuery(event.target.value)
            }}
            onKeyDown={handleKeyDown}
          />
          <textarea
            ref={measurementTextareaRef}
            className="query-input-measurement"
            aria-hidden="true"
            tabIndex={-1}
            rows={1}
            value={query}
            readOnly
          />
          <div ref={actionsRef} className="query-input-actions">
            <ModelSelector disabled={disabled || busy || Boolean(model?.pending)} {...(model ? { binding: model } : {})} />
            <Button
              className="button-composer query-input-submit"
              type={onStop ? 'button' : 'submit'}
              variant={onStop ? 'danger' : 'primary'}
              iconName={onStop ? 'stop-mini' : 'send-ins'}
              iconType={onStop ? 'fill' : 'line'}
              tooltipMessage={onStop ? 'Stop this turn' : 'Send message'}
              tooltipPosition="top"
              disabled={onStop ? disabled : submitDisabled}
              loading={!onStop && busy}
              {...(onStop ? { onClick: onStop } : {})}
            />
          </div>
        </form>
        {failed && <Button disabled={disabled || busy} onClick={() => formRef.current?.requestSubmit()}>Retry sending message</Button>}
        {showFocusWave && (
          <QueryInputFocusWave
            key={focusWaveKey}
            formRef={formRef}
            onComplete={() => setShowFocusWave(false)}
          />
        )}
      </div>
    </VisualPreviewProvider>
  )
}
