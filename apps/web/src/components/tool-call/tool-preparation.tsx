import { useContext } from 'react'
import { useMutation } from '@tanstack/react-query'
import { PreparationWidget } from '../../../../../aurora/src/v2/widgets/preparation'
import type { ToolPreparationSnapshot } from '../../../../../aurora/src/v2/contracts/preparation'
import { ConversationDetailsContext } from '@/data/conversation-details'
import { requestAPI } from '@/data/api'
import { useProfile, PROFILE_AUTH_QUERY_KEY } from '@/data/profile'
import { queryClient } from '@/query-client'
import { useToast } from '@/components/toast'

/**
 * Shows the originating call's observed setup state. Cancellation targets the
 * retained, session-owned execution; it never retries or reissues a tool action.
 */
export function ToolPreparation({ preparation }: { preparation: ToolPreparationSnapshot }) {
  const owner = useContext(ConversationDetailsContext)
  const profile = useProfile()
  const subject = preparation.purpose === 'download' ? 'download' : 'preparation'
  const { showToast } = useToast()
  const request = useMutation({
    meta: { errorTitle: `I could not cancel the ${subject}`, profile },
    retry: false,
    mutationFn: () => requestAPI<{ execution: { state: string } }>('tool-executions/cancel', {
      method: 'POST', body: JSON.stringify({ sessionId: owner?.sessionId, executionId: preparation.executionId })
    }),
    onSuccess: ({ execution }) => {
      if (queryClient.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)?.profile_name === profile) {
        showToast({ type: 'success', title: execution.state === 'canceled'
          ? `I cancelled the ${subject}` : 'I requested cancellation',
          description: execution.state === 'canceled' ? `The ${subject} has stopped.` : 'I’ll show the result when the tool stops.' })
      }
    }
  })

  return <PreparationWidget title={preparation.purpose === 'download' ? 'Downloads' : 'Getting files ready'} {...preparation}
    cancelling={request.isPending || request.isSuccess}
    {...(owner && preparation.executionId ? { onCancel: () => request.mutate() } : {})} />
}
