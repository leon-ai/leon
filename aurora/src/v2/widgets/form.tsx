import { useId } from 'react'
import { Input } from '../components/input/input'
import { Button } from '../components/button/button'
import { Surface } from '../components/surface'
import { SubmissionFeedback } from './submission-feedback'
import { SubmissionStatus, useSubmission } from './use-submission'

export interface FormField {
  name: string
  label: string
  type: 'text' | 'email' | 'number' | 'date' | 'time' | 'textarea' | 'select'
  required?: boolean
  placeholder?: string
  initialValue?: string
  options?: readonly { value: string, label: string }[]
}

export interface FormWidgetProps {
  title: string
  description?: string
  fields: readonly FormField[]
  submitLabel?: string
  onSubmit: (values: Record<string, string>) => void | Promise<void>
  submitted?: boolean
  readOnly?: boolean
  initialValues?: Record<string, string>
  onDraftChange?: (values: Record<string, string>) => void
}

function readFormValues(form: HTMLFormElement, fields: readonly FormField[]): Record<string, string> {
  const data = new FormData(form)

  // An unselected select has no successful option in FormData. Keep its empty
  // value so a partial draft can still restore all of the declared fields.
  return Object.fromEntries(fields.map((field) => [field.name, String(data.get(field.name) ?? '')]))
}

/**
 * Uses native field constraints and form serialization without sending keystrokes to the host.
 */
export function FormWidget({ title, description, fields, submitLabel = 'Save', onSubmit,
  submitted = false, readOnly = false, initialValues, onDraftChange }: FormWidgetProps) {
  const formId = useId()
  const { status: localStatus, disabled: localDisabled, submit } = useSubmission(onSubmit)
  const status = submitted ? SubmissionStatus.Submitted : localStatus
  const disabled = localDisabled || submitted || readOnly

  return <Surface title={title} {...(description === undefined ? {} : { description })} footer={<>
    <SubmissionFeedback status={status} />
    <Button type="submit" form={formId} variant="primary" disabled={disabled}
      loading={status === SubmissionStatus.Pending}>{submitLabel}</Button>
  </>}>
    <form id={formId} className="aurora-fields" onChange={(event) => {
      if (onDraftChange && !disabled) {
        onDraftChange(readFormValues(event.currentTarget, fields))
      }
    }} onSubmit={(event) => {
      event.preventDefault()
      const values = readFormValues(event.currentTarget, fields)
      if (!disabled) {
        void submit(values)
      }
    }}>
      <fieldset className="aurora-fields" disabled={disabled} aria-label={title}>
        {fields.map((field) => <label className="aurora-field" key={field.name}>
          <span>{field.label}</span>
          {field.type === 'select' ? (
            <select name={field.name} required={field.required} defaultValue={initialValues?.[field.name] ?? field.initialValue ?? ''}>
              <option value="" disabled>Choose an option</option>
              {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : field.type === 'textarea' ? (
            <Input ariaLabel={field.label} multiline name={field.name} required={field.required}
              placeholder={field.placeholder} defaultValue={initialValues?.[field.name] ?? field.initialValue} />
          ) : (
            <Input ariaLabel={field.label} type={field.type} name={field.name} required={field.required}
              placeholder={field.placeholder} defaultValue={initialValues?.[field.name] ?? field.initialValue} />
          )}
        </label>)}
      </fieldset>
    </form>
  </Surface>
}
