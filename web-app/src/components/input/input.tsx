import type {
  InputHTMLAttributes,
  Ref,
  TextareaHTMLAttributes
} from 'react'
import { useId } from 'react'
import { clsx } from 'clsx'

import './input.sass'

type InputIconType = 'line' | 'fill'
type InputSize = 'medium' | 'large'
type InputVariant = 'default' | 'embedded'

interface InputSharedProps {
  ariaLabel: string
  className?: string
  fieldRef?: Ref<HTMLInputElement | HTMLTextAreaElement>
  iconName?: string
  iconType?: InputIconType
  size?: InputSize
  variant?: InputVariant
}

type NativeInputProps = InputSharedProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'aria-label' | 'className' | 'size'> & {
    multiline?: false
  }

type NativeTextareaProps = InputSharedProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'aria-label' | 'className'> & {
    multiline: true
  }

type InputProps = NativeInputProps | NativeTextareaProps

export function Input({
  ariaLabel,
  className,
  fieldRef,
  iconName,
  iconType = 'line',
  multiline = false,
  size = 'medium',
  variant = 'default',
  ...fieldProps
}: InputProps) {
  const generatedId = useId()
  const inputId = fieldProps.id ?? generatedId
  const inputClassName = clsx(
    'input',
    `input-${size}`,
    `input-${variant}`,
    className,
    {
    'input-with-icon': iconName !== undefined
    }
  )

  return (
    <span className={inputClassName}>
      {iconName !== undefined && (
        <i
          className={`input-icon ri-${iconName}-${iconType}`}
          aria-hidden="true"
        />
      )}
      {multiline ? (
        <textarea
          {...(fieldProps as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          id={inputId}
          className="input-field"
          aria-label={ariaLabel}
          ref={fieldRef as Ref<HTMLTextAreaElement>}
        />
      ) : (
        <input
          {...(fieldProps as InputHTMLAttributes<HTMLInputElement>)}
          id={inputId}
          className="input-field"
          aria-label={ariaLabel}
          ref={fieldRef as Ref<HTMLInputElement>}
        />
      )}
    </span>
  )
}
