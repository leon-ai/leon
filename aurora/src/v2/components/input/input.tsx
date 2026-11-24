import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes
} from 'react'
import { useCallback, useId, useLayoutEffect, useRef } from 'react'
import { clsx } from 'clsx'

import { InputEffects, type TextField } from './input-effects'

import './input.sass'

type InputSize = 'medium' | 'large'
type InputVariant = 'default' | 'embedded' | 'header'

interface InputSharedProps {
  ariaLabel: string
  className?: string
  fieldRef?: Ref<HTMLInputElement | HTMLTextAreaElement>
  icon?: ReactNode
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

export type InputProps = NativeInputProps | NativeTextareaProps

/**
 * Shares native fields, selection and typing motion across application and widget forms.
 */
export function Input({
  ariaLabel,
  className,
  fieldRef,
  icon,
  multiline = false,
  size = 'medium',
  variant = 'default',
  ...fieldProps
}: InputProps) {
  const generatedId = useId()
  const nativeFieldRef = useRef<TextField | null>(null)
  const refreshEffects = useRef<(() => void) | null>(null)
  const setFieldRef = useCallback((field: TextField | null) => {
    nativeFieldRef.current = field

    if (typeof fieldRef === 'function') {
      const cleanup = fieldRef(field)

      return () => {
        nativeFieldRef.current = null

        if (typeof cleanup === 'function') {
          cleanup()
        } else {
          fieldRef(null)
        }
      }
    }

    if (fieldRef !== undefined && fieldRef !== null) {
      fieldRef.current = field
    }

    return undefined
  }, [fieldRef])
  const inputId = fieldProps.id ?? generatedId
  const inputClassName = clsx(
    'input',
    `input-${size}`,
    `input-${variant}`,
    className,
    {
    'input-with-icon': icon !== undefined
    }
  )
  const wrap = 'wrap' in fieldProps ? fieldProps.wrap : undefined
  const type = 'type' in fieldProps ? fieldProps.type : undefined

  useLayoutEffect(() => {
    // Browser events cover editing and resizing. React can also replace the
    // field's value or presentation without emitting a native input event.
    refreshEffects.current?.()
  }, [multiline, inputId, inputClassName, wrap, type, fieldProps.value,
    fieldProps.defaultValue, fieldProps.placeholder, fieldProps.style, fieldProps.dir,
    fieldProps.lang, fieldProps.disabled, fieldProps.readOnly, fieldProps.hidden])

  return (
    <span className={inputClassName}>
      {icon !== undefined && (
        <span className="input-icon" aria-hidden="true">{icon}</span>
      )}
      {multiline ? (
        <textarea
          {...(fieldProps as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          rows={variant === 'embedded' ? (fieldProps as TextareaHTMLAttributes<HTMLTextAreaElement>).rows ?? 1
            : Math.max(4, (fieldProps as TextareaHTMLAttributes<HTMLTextAreaElement>).rows ?? 4)}
          id={inputId}
          className="input-field"
          aria-label={ariaLabel}
          ref={setFieldRef}
        />
      ) : (
        <input
          {...(fieldProps as InputHTMLAttributes<HTMLInputElement>)}
          id={inputId}
          className="input-field"
          aria-label={ariaLabel}
          ref={setFieldRef}
        />
      )}
      <InputEffects key={multiline ? 'textarea' : 'input'} fieldRef={nativeFieldRef} refreshRef={refreshEffects} />
    </span>
  )
}
