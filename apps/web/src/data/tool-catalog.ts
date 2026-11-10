import { useMutation, useQuery, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query'
import { requestAPI } from './api'
import { useProfile, PROFILE_AUTH_QUERY_KEY } from './profile'
import { queryClient } from '@/query-client'
import { useToast } from '@/components/toast'
import type { ToolCatalogEntry } from '../../../../server/src/core/tool-manager/tool-source'

export type { ToolCatalogEntry }
export type ToolAction = 'enable' | 'disable' | 'disconnect' | 'remove'
export interface AddMCPServer {
  catalogId?: string
  name?: string
  url?: string
  clientId?: string
  clientMetadataUrl?: string
}

interface ToolManagement {
  install: UseMutationResult<{ id: string }, Error, AddMCPServer>
  action: UseMutationResult<unknown, Error, { id: string, action: ToolAction }>
  refresh: () => Promise<void>
}

/**
 * Shares one profile-scoped catalog between settings and connection dialogs.
 */
export function useToolCatalog(): UseQueryResult<{ tools: ToolCatalogEntry[] }> {
  const profile = useProfile()

  return useQuery({ queryKey: ['tool-catalog', profile], enabled: Boolean(profile),
    meta: { profile, errorTitle: 'I couldn’t load your tools' },
    queryFn: ({ signal }) => requestAPI<{ tools: ToolCatalogEntry[] }>('tools/catalog', { signal }) })
}

/**
 * Reports management success only after acceptance; request errors use the
 * shared reporter. No credentials or automatic write retries enter this cache.
 */
export function useToolManagement(): ToolManagement {
  const profile = useProfile()
  const { showToast } = useToast()
  const isCurrentProfile = (): boolean => queryClient.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)?.profile_name === profile
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['tool-catalog', profile], exact: true })
  }
  const install = useMutation({
    meta: { profile, errorTitle: 'I couldn’t add this tool' }, retry: false,
    mutationFn: (input: AddMCPServer) => requestAPI<{ id: string }>('tools', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: async () => {
      if (!isCurrentProfile()) {
        return
      }
      showToast({ type: 'success', title: 'Tool added', description: 'It’s available in this profile.' })
      await refresh()
    }
  })
  const action = useMutation({
    meta: { profile, errorTitle: 'I couldn’t update this tool' }, retry: false,
    mutationFn: (input: { id: string, action: ToolAction }) => requestAPI(`tools/${encodeURIComponent(input.id)}`, {
      method: 'POST', body: JSON.stringify({ action: input.action })
    }),
    onSuccess: async (_result, input) => {
      if (!isCurrentProfile()) {
        return
      }
      const titles: Record<ToolAction, string> = { enable: 'Tool enabled', disable: 'Tool disabled',
        disconnect: 'Account disconnected', remove: 'Tool removed' }
      showToast({ type: 'success', title: titles[input.action], description: '' })
      await refresh()
    }
  })

  return { install, action, refresh }
}
