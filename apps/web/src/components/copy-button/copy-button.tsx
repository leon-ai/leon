import { useEffect, useRef, useState, type ComponentProps } from 'react'

import { Button } from '@/components/button'
import { useToast } from '@/components/toast'
import { Tooltip } from '@/components/tooltip'
import { Icon } from '@/components/icon'
import { useActionConfirmation } from '@/hooks/use-action-confirmation'

interface CopyButtonProps extends Pick<ComponentProps<typeof Button>, 'className' | 'size' | 'tone' | 'variant' | 'tooltipPosition'> {
  text?: string | undefined
  onCopy?: () => Promise<void>
  errorTitle?: string
  errorDescription?: string
  label?: string
  disabled?: boolean
  busy?: boolean
  iconName?: 'file-copy' | 'multi-image'
}

/**
 * Confirms successful clipboard writes inline and reports actionable failures once.
 */
export function CopyButton({ text, onCopy, errorTitle = 'I couldn’t copy this text',
  errorDescription = 'Your browser did not allow clipboard access. Select the text and copy it manually instead.',
  label = 'Copy', disabled = false, busy = false, iconName = 'file-copy', tooltipPosition = 'bottom', ...buttonProps }: CopyButtonProps) {
  const { showToast } = useToast()
  const { confirmed: copied, confirm, reset } = useActionConfirmation()
  const [pending, setPending] = useState(false)
  const operation = useRef(0)
  const copying = useRef(false)

  useEffect(() => {
    reset()
    setPending(false)
    copying.current = false

    return () => {
      // A late clipboard result must not update another inspector tab or a closed dialog.
      operation.current += 1
    }
  }, [text, disabled, reset])

  async function copy(): Promise<void> {
    if (disabled || (text === undefined && !onCopy) || copying.current) {
      return
    }

    const currentOperation = ++operation.current
    copying.current = true
    reset()
    setPending(true)

    try {
      if (onCopy) {
        await onCopy()
      } else {
        await navigator.clipboard.writeText(text!)
      }

      if (operation.current !== currentOperation) {
        return
      }

      confirm()
    } catch {
      if (operation.current === currentOperation) {
        reset()
        showToast({
          type: 'error',
          title: errorTitle,
          description: errorDescription
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
      <Button {...buttonProps} icon={<Icon name={iconName} state={copied ? 'copied' : 'idle'} />}
        ariaLabel={copied ? 'Copied' : label} ariaBusy={pending}
        disabled={disabled || busy || (text === undefined && !onCopy)} onClick={() => void copy()} />
    </Tooltip>
  )
}
