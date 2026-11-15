import { useMutation } from '@tanstack/react-query'

import { CopyButton } from '@/components/copy-button'
import { FileIcon } from '@/components/icon'
import { Loader } from '@/components/loader'
import { StreamingText } from '@/components/streaming-text'
import { Tooltip } from '@/components/tooltip'
import { useToast } from '@/components/toast'
import { APIError, requestAPI } from '@/data/api'
import { useProfile, PROFILE_AUTH_QUERY_KEY } from '@/data/profile'
import { queryClient } from '@/query-client'

import './file-path.sass'

/**
 * Opens only an explicitly clicked path on Leon's host, never a browser file URL
 * or an automatic download. Unfinished streaming references remain plain text.
 */
export function FilePath({ path, complete, animationId }: { path: string, complete: boolean, animationId: string }) {
  const profile = useProfile()
  const { showToast } = useToast()
  const request = useMutation({
    meta: { errorTitle: 'I could not open this path', profile },
    retry: false,
    mutationFn: async () => {
      try {
        await requestAPI('open-path', { method: 'POST', body: JSON.stringify({ path }) })
      } catch (error) {
        if (error instanceof APIError && error.status === 404) {
          throw new Error('This path is no longer available on my host. You can still copy it.')
        }
        throw error
      }
    },
    onSuccess: () => {
      if (queryClient.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)?.profile_name === profile) {
        showToast({ type: 'success', title: 'I opened the path on my host', description: path })
      }
    }
  })
  const label = <StreamingText animationId={animationId} text={path} compact />

  if (!complete) {
    return <span className="file-path-pending">{label}</span>
  }

  return <span className="file-path-reference">
    <Tooltip message={`Open on Leon’s host\n${path}`} multiline position="top" className="inline-link-tooltip">
      <button className="file-path-open" type="button" aria-label={`Open ${path} on Leon’s host`}
        disabled={request.isPending} aria-busy={request.isPending} onClick={() => request.mutate()}>
        <span className="inline-link" aria-disabled={request.isPending || undefined}>
          <span className="inline-link-icon" aria-hidden="true">
            {request.isPending ? <Loader size="xs" /> : <FileIcon fileName={path} />}
          </span>{label}
        </span>
      </button>
    </Tooltip>
    <CopyButton className="file-path-copy" text={path} label="Copy path" size="sm" />
  </span>
}
