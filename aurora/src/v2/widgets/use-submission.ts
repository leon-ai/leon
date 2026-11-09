import { useEffect, useRef, useState } from 'react'

export enum SubmissionStatus {
  Ready = 'ready',
  Pending = 'pending',
  Submitted = 'submitted',
  Failed = 'failed'
}

/**
 * Locks duplicate submissions synchronously and ignores results after unmount.
 * The host owns persistence and transport; failures keep the current field values.
 */
export function useSubmission<T>(onSubmit: (value: T) => void | Promise<void>): {
  status: SubmissionStatus
  submit: (value: T) => Promise<void>
  disabled: boolean
} {
  const [status, setStatus] = useState(SubmissionStatus.Ready)
  const locked = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true

    return (): void => {
      mounted.current = false
    }
  }, [])

  async function submit(value: T): Promise<void> {
    if (locked.current) {
      return
    }

    locked.current = true
    setStatus(SubmissionStatus.Pending)

    try {
      await onSubmit(value)

      if (mounted.current) {
        setStatus(SubmissionStatus.Submitted)
      }
    } catch {
      locked.current = false

      if (mounted.current) {
        setStatus(SubmissionStatus.Failed)
      }
    }
  }

  return { status, submit, disabled: status === SubmissionStatus.Pending || status === SubmissionStatus.Submitted }
}
