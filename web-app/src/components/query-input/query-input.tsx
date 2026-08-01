import { clsx } from 'clsx'
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'

import { Button } from '../button'
import { Input } from '../input'

import './query-input.sass'

const DEFAULT_PLACEHOLDER = 'Don’t be shy'
const DEFAULT_MAXIMUM_LINE_COUNT = 12
const HEIGHT_COMPARISON_TOLERANCE = 1

interface QueryInputProps {
  autoFocus?: boolean
  disabled?: boolean
  loading?: boolean
  maximumLineCount?: number
  placeholder?: string
  onAddAttachment?: () => void
  onSubmit?: (query: string) => void
}

export function QueryInput({
  autoFocus = false,
  disabled = false,
  loading = false,
  maximumLineCount = DEFAULT_MAXIMUM_LINE_COUNT,
  placeholder = DEFAULT_PLACEHOLDER,
  onAddAttachment,
  onSubmit
}: QueryInputProps) {
  const [query, setQuery] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [isScrollable, setIsScrollable] = useState(false)
  const [formHeight, setFormHeight] = useState<number>()
  const actionsRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const leadingActionRef = useRef<HTMLDivElement>(null)
  const measurementTextareaRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const normalizedQuery = query.trim()
  const submitDisabled = disabled || normalizedQuery.length === 0
  const resolvedMaximumLineCount = Math.max(1, maximumLineCount)

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
    const maximumHeight =
      lineHeight * resolvedMaximumLineCount + verticalPadding + verticalBorder
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
    measurementTextarea.style.width = `${inlineFieldWidth}px`

    const inlineContentHeight =
      measurementTextarea.scrollHeight + verticalBorder
    const shouldExpand =
      inlineContentHeight > singleLineHeight + HEIGHT_COMPARISON_TOLERANCE

    measurementTextarea.style.width = `${
      shouldExpand ? expandedFieldWidth : inlineFieldWidth
    }px`

    const contentHeight = measurementTextarea.scrollHeight + verticalBorder
    const minimumExpandedHeight =
      (lineHeight * 2) + verticalPadding + verticalBorder
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

    const actionRowHeight = Math.max(
      leadingAction.offsetHeight,
      actions.offsetHeight
    )
    const contentAreaHeight = shouldExpand
      ? nextHeight + gap + actionRowHeight
      : Math.max(nextHeight, actionRowHeight)
    const minimumFormHeight = Number.parseFloat(formStyle.minHeight)

    setFormHeight(Math.max(
      minimumFormHeight,
      contentAreaHeight + verticalFormPadding + verticalFormBorder
    ))
    setIsExpanded(shouldExpand)
    setIsScrollable(
      contentHeight > maximumHeight + HEIGHT_COMPARISON_TOLERANCE
    )
  }, [resolvedMaximumLineCount])

  useLayoutEffect(() => {
    updateTextareaHeight()
  }, [query, updateTextareaHeight])

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

    return () => resizeObserver.disconnect()
  }, [updateTextareaHeight])

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    if (submitDisabled || loading) {
      return
    }

    onSubmit?.(normalizedQuery)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return
    }

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <div className="query-input-container">
      <div className="query-input-glow" aria-hidden="true" />
      <form
        ref={formRef}
        className={clsx('query-input', {
          'query-input-expanded': isExpanded
        })}
        aria-label="Send a message to Leon"
        style={formHeight === undefined ? undefined : {
          height: `${formHeight}px`
        }}
        onSubmit={handleSubmit}
      >
        <div ref={leadingActionRef} className="query-input-leading-action">
          <Button
            className="query-input-add"
            iconName="add-large"
            tooltipMessage="Add attachment"
            tooltipPosition="top"
            disabled={disabled || loading}
            {...(onAddAttachment === undefined ? {} : {
              onClick: onAddAttachment
            })}
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
          autoFocus={autoFocus}
          disabled={disabled || loading}
          onChange={(event) => setQuery(event.target.value)}
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
          <Button
            className="query-input-submit"
            type="submit"
            variant="primary"
            iconName="send-ins"
            tooltipMessage="Send message"
            tooltipPosition="top"
            disabled={submitDisabled}
            loading={loading}
          />
        </div>
      </form>
    </div>
  )
}
