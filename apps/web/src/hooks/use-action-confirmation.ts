import { useCallback, useEffect, useRef, useState } from 'react'

const CONFIRMATION_DURATION_MS = 1_500

/**
 * Keeps confirmed action feedback visible briefly and releases its timer on exit.
 */
export function useActionConfirmation(): { confirmed: boolean, confirm: () => void, reset: () => void } {
  const [confirmed, setConfirmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reset = useCallback(() => {
    clearTimeout(timer.current)
    setConfirmed(false)
  }, [])
  const confirm = useCallback(() => {
    clearTimeout(timer.current)
    setConfirmed(true)
    timer.current = setTimeout(() => setConfirmed(false), CONFIRMATION_DURATION_MS)
  }, [])

  useEffect(() => (): void => {
    clearTimeout(timer.current)
  }, [])

  return { confirmed, confirm, reset }
}
