import { useMutation, useQuery, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query'

import { requestAPI } from './api'
import { useProfile, PROFILE_AUTH_QUERY_KEY } from './profile'
import { queryClient } from '@/query-client'
import { useToast } from '@/components/toast'
import type { SkillCatalogEntry } from '../../../../server/src/core/catalog/types'

export type { SkillCatalogEntry }
export type SkillAction = 'install' | 'enable' | 'disable' | 'remove'

/**
 * Uses the profile-scoped server catalog rather than deriving installed skill
 * state from browser persistence or tool connections.
 */
export function useSkillCatalog(): UseQueryResult<{ skills: SkillCatalogEntry[] }> {
  const profile = useProfile()

  return useQuery({ queryKey: ['skill-catalog', profile], enabled: Boolean(profile),
    meta: { profile, errorTitle: 'I couldn’t load your skills' },
    queryFn: ({ signal }) => requestAPI<{ skills: SkillCatalogEntry[] }>('skills/catalog', { signal }) })
}

/**
 * Availability updates never enable dependencies or automatically replay writes.
 */
export function useSkillManagement(): UseMutationResult<unknown, Error, { id: string, action: SkillAction }> {
  const profile = useProfile()
  const { showToast } = useToast()

  return useMutation({ meta: { profile, errorTitle: 'I couldn’t update this skill' }, retry: false,
    mutationFn: (input: { id: string, action: SkillAction }) => requestAPI(`skills/${encodeURIComponent(input.id)}`, {
      method: 'POST', body: JSON.stringify({ action: input.action })
    }),
    onSuccess: async (_result, input) => {
      if (queryClient.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)?.profile_name !== profile) {
        return
      }
      const titles: Record<SkillAction, string> = { install: 'Skill added', enable: 'Skill enabled', disable: 'Skill disabled', remove: 'Skill removed' }
      showToast({ type: 'success', title: titles[input.action], description: '' })
      await queryClient.invalidateQueries({ queryKey: ['skill-catalog', profile], exact: true })
    }
  })
}
