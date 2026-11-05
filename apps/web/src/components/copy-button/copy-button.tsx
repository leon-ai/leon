import { useEffect, useRef, useState, type ComponentProps } from 'react'

import { Button } from '@/components/button'
import { useToast } from '@/components/toast'
import { Tooltip } from '@/components/tooltip'
import { Icon } from '@/components/icon'

const COPIED_DURATION_MS = 1_500

interface CopyButtonProps extends Pick<ComponentProps<typeof Button>, 'className' | 'size' | 'tone' | 'variant' | 'tooltipPosition'> {
  text: string | undefined
  label?: string
  disabled?: boolean
}

/**
 * Confirms successful clipboard writes inline and reports actionable failures once.
 */
export function CopyButton({ text, label = 'Copy', disabled = false, tooltipPosition = 'bottom', ...buttonProps }: CopyButtonProps) {
  const { showToast } = useToast()
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const operation = useRef(0)
  const copying = useRef(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setCopied(false)
    setPending(false)
    copying.current = false

    return () => {
      // A late clipboard result must not update another inspector tab or a closed dialog.
      operation.current += 1
      clearTimeout(resetTimer.current)
    }
  }, [text, disabled])

  async function copy(): Promise<void> {
    if (disabled || text === undefined || copying.current) {
      return
    }

    const currentOperation = ++operation.current
    copying.current = true
    clearTimeout(resetTimer.current)
    setPending(true)

    try {
      await navigator.clipboard.writeText(text)

      if (operation.current !== currentOperation) {
        return
      }

      setCopied(true)
      resetTimer.current = setTimeout(() => setCopied(false), COPIED_DURATION_MS)
    } catch {
      if (operation.current === currentOperation) {
        setCopied(false)
        showToast({
          type: 'error',
          title: 'I couldn’t copy this text',
          description: 'Your browser did not allow clipboard access. Select the text and copy it manually instead.'
        })
      }
    } finally {
      if (operation.current === currentOperation) {
        copying.current = false
        setPending(false)
      }
    }
  }

  return (
    <Tooltip message={copied ? 'Copied' : label} position={tooltipPosition}
      closeOnClick={false} blurOnClick={false}>
      <Button {...buttonProps} icon={<Icon name="file-copy" state={copied ? 'copied' : 'idle'} />}
        ariaLabel={copied ? 'Copied' : label} ariaBusy={pending}
        disabled={disabled || text === undefined} onClick={() => void copy()} />
    </Tooltip>
  )
}
