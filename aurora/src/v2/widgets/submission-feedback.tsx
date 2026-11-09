import { SubmissionStatus } from './use-submission'

/**
 * Reports accepted submissions separately from failures without clearing the form.
 */
export function SubmissionFeedback({ status }: { status: SubmissionStatus }) {
  if (status === SubmissionStatus.Submitted) {
    return <p className="aurora-feedback" role="status">Saved. Thank you.</p>
  }

  if (status === SubmissionStatus.Failed) {
    return <p className="aurora-feedback" role="alert">I couldn't save this. Please try again.</p>
  }

  return null
}
