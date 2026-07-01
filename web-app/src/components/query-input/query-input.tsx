import { useState, type FormEvent } from 'react'

import { Button } from '../button'
import { Input } from '../input'

import './query-input.sass'

const DEFAULT_PLACEHOLDER = 'Don’t be shy'

interface QueryInputProps {
  autoFocus?: boolean
  disabled?: boolean
  loading?: boolean
  placeholder?: string
  onAddAttachment?: () => void
  onMicrophoneClick?: () => void
  onSubmit?: (query: string) => void
}

export function QueryInput({
  autoFocus = false,
  disabled = false,
  loading = false,
  placeholder = DEFAULT_PLACEHOLDER,
  onAddAttachment,
  onMicrophoneClick,
  onSubmit
}: QueryInputProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim()
  const submitDisabled = disabled || normalizedQuery.length === 0

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    if (submitDisabled || loading) {
      return
    }

    onSubmit?.(normalizedQuery)
  }

  return (
    <form
      className="query-input"
      aria-label="Send a message to Leon"
      onSubmit={handleSubmit}
    >
      <Button
        className="query-input-add"
        iconName="add"
        tooltipMessage="Add attachment"
        tooltipPosition="top"
        disabled={disabled || loading}
        {...(onAddAttachment === undefined ? {} : {
          onClick: onAddAttachment
        })}
      />
      <Input
        ariaLabel="Message Leon"
        className="query-input-field"
        variant="embedded"
        name="query"
        placeholder={placeholder}
        value={query}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled || loading}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Button
        className="query-input-microphone"
        iconName="mic"
        tooltipMessage="Use microphone"
        tooltipPosition="top"
        disabled={disabled || loading}
        {...(onMicrophoneClick === undefined ? {} : {
          onClick: onMicrophoneClick
        })}
      />
      <Button
        className="query-input-submit"
        type="submit"
        variant="secondary"
        iconName="send-ins"
        tooltipMessage="Send message"
        tooltipPosition="top"
        disabled={submitDisabled}
        loading={loading}
      />
    </form>
  )
}
