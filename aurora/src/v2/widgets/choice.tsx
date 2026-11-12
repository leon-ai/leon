import { useId, useRef, useState } from 'react'
import { Button } from '../components/button/button'
import { Selection } from '../components/selection'
import { Surface } from '../components/surface'
import { Loader } from '../components/loader/loader'
import { SubmissionFeedback } from './submission-feedback'
import { SubmissionStatus, useSubmission } from './use-submission'

export interface ChoiceOption {
  value: string
  label: string
  description?: string
}

export interface ChoiceWidgetProps {
  title: string
  description?: string
  options: readonly ChoiceOption[]
  multiple?: boolean
  initialValue?: readonly string[]
  submitLabel?: string
  onSubmit: (values: string[]) => void | Promise<void>
  submitted?: boolean
  readOnly?: boolean
  onDraftChange?: (values: string[]) => void
}

export interface BooleanChoiceWidgetProps extends Omit<ChoiceWidgetProps, 'options' | 'multiple' | 'initialValue' | 'onSubmit' | 'onDraftChange'> {
  initialValue?: boolean
  onSubmit: (value: boolean) => void | Promise<void>
  onDraftChange?: (value: boolean) => void
}

/**
 * Activates single answers directly; multiple selections require confirmation.
 * Restored values and native arrow-key browsing never submit an answer.
 */
export function ChoiceWidget({
  title, description, options, multiple = false, initialValue = [],
  submitLabel = 'Continue', onSubmit, submitted = false, readOnly = false, onDraftChange
}: ChoiceWidgetProps) {
  const name = useId()
  const browsing = useRef(false)
  const [selected, setSelected] = useState(() => initialValue
    .filter((value) => options.some((option) => option.value === value))
    .slice(0, multiple ? undefined : 1))
  const { status: localStatus, disabled: localDisabled, submit } = useSubmission(onSubmit)
  const status = submitted ? SubmissionStatus.Submitted : localStatus
  const disabled = localDisabled || submitted || readOnly
  const choicesDisabled = disabled || !multiple && status === SubmissionStatus.Failed

  function choose(next: string[]): void {
    setSelected(next)
    onDraftChange?.(next)
  }

  function activate(value: string): void {
    if (choicesDisabled) {
      return
    }

    const next = [value]
    choose(next)
    void submit(next)
  }

  return <Surface title={title} {...(description === undefined ? {} : { description })}
    footer={(multiple || status !== SubmissionStatus.Ready) && <>
      <SubmissionFeedback status={status} />
      {multiple && <Button type="submit" form={name} variant="primary" disabled={disabled || selected.length === 0}
        loading={status === SubmissionStatus.Pending}>{submitLabel}</Button>}
      {!multiple && status === SubmissionStatus.Pending && <Loader size="sm" label="Saving…" />}
      {!multiple && status === SubmissionStatus.Failed && <Button variant="secondary" disabled={disabled}
        onClick={() => {
          void submit(selected)
        }}>Retry</Button>}
    </>}>
    <form id={name} className="aurora-fields" onSubmit={(event) => {
      event.preventDefault()
      if (multiple && !disabled && selected.length > 0) {
        void submit(selected)
      }
    }}>
      <fieldset className="aurora-fields" aria-label={title} aria-busy={status === SubmissionStatus.Pending}
        disabled={choicesDisabled}
        onKeyDownCapture={(event) => {
          // Native arrows also dispatch radio clicks. Only an explicit
          // activation may commit, while the browser keeps owning navigation.
          browsing.current = event.key.startsWith('Arrow')
        }}
        onKeyUpCapture={() => {
          browsing.current = false
        }}
        onPointerDownCapture={() => {
          browsing.current = false
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            browsing.current = false
          }
        }}>
        {options.map((option) => <Selection key={option.value}
          name={name} value={option.value} label={option.label} description={option.description}
          multiple={multiple} checked={selected.includes(option.value)}
          onClick={() => {
            if (!multiple && !browsing.current) {
              activate(option.value)
            }
          }}
          onKeyDown={(event) => {
            if (!multiple && !event.altKey && !event.ctrlKey && !event.metaKey &&
              (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              activate(option.value)
            }
          }}
          onChange={(event) => {
            if (choicesDisabled || !multiple && !browsing.current) {
              return
            }

            const checked = event.target.checked
            const next = !multiple ? [option.value] : checked ? [...selected, option.value] : selected.filter((value) => value !== option.value)
            choose(next)
          }}
        />)}
      </fieldset>
    </form>
  </Surface>
}

/**
 * Gives yes/no questions the same submission lifecycle as other choice widgets.
 */
export function BooleanChoiceWidget({ initialValue, onSubmit, onDraftChange, ...props }: BooleanChoiceWidgetProps) {
  return <ChoiceWidget {...props}
    initialValue={initialValue === undefined ? [] : [initialValue ? 'yes' : 'no']}
    options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
    onSubmit={(values) => onSubmit(values[0] === 'yes')}
    onDraftChange={(values) => onDraftChange?.(values[0] === 'yes')}
  />
}
