import React, { useState } from 'react'
import classNames from 'classnames'

import { Text, Icon } from '..'

import './text-input.sass'

interface Props {
  placeholder: string
  value?: string
  type?: 'text' | 'password' | 'email' | 'tel' | 'url'
  iconName?: string
  hint?: string
  disabled?: boolean
  height?: number | 'auto'
  maxLength?: number
  multiline?: boolean
  autofocus?: boolean
  onChange?: (value: string) => void
}

export function TextInput({
  placeholder,
  type = 'text',
  iconName,
  hint,
  value,
  disabled,
  height = 'auto',
  maxLength,
  multiline,
  autofocus,
  onChange
}: Props) {
  const [inputValue, setInputValue] = useState(value || '')

  if (!multiline) {
    if (!maxLength) {
      maxLength = 64
    }

    if (height !== 'auto') {
      height = 'auto'
    }
  }

  return (
    <div className="aurora-text-input-container">
      {multiline ? (
        <textarea
          placeholder={placeholder}
          value={inputValue}
          disabled={disabled}
          autoFocus={autofocus}
          maxLength={maxLength}
          onChange={(e) => {
            setInputValue(e.target.value)

            if (onChange) {
              onChange(e.target.value)
            }
          }}
          style={{ height }}
          className={classNames('aurora-text-input', {
            'aurora-text-input--multiline': true,
            'aurora-text-input--disabled': disabled,
            'aurora-text-input--with-icon': !!iconName
          })}
        />
      ) : (
        <input
          type={type}
          placeholder={placeholder}
          value={inputValue}
          disabled={disabled}
          autoFocus={autofocus}
          maxLength={maxLength}
          onChange={(e) => {
            setInputValue(e.target.value)

            if (onChange) {
              onChange(e.target.value)
            }
          }}
          className={classNames('aurora-text-input', {
            'aurora-text-input--disabled': disabled,
            'aurora-text-input--with-icon': !!iconName
          })}
        />
      )}
      {iconName && (
        <div className="aurora-text-input-icon-container">
          <Icon name={iconName} type="fill" />
        </div>
      )}
      {hint && (
        <div className="aurora-text-input-hint-container">
          <Text fontSize="xs" tertiary>
            {hint}
          </Text>
        </div>
      )}
    </div>
  )
}
