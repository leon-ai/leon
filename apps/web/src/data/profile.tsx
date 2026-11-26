import { createContext, Fragment, useContext, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Selection } from '../../../../aurora/src/v2/components/selection'
import { DesktopComputerUseApproval } from '../../../../bridges/runtime/contracts/desktop-client'

import { Button } from '@/components/button'
import { Input } from '@/components/input'
import { RequestFeedback } from '@/components/request-feedback/request-feedback'
import { queryClient } from '@/query-client'
import { useToast } from '@/components/toast'

import { requestAPI } from './api'
import { enableDesktopComputerUse, getDesktopComputerUseSetup } from './desktop-computer-use'
import { isDesktopClient } from './turn-client'
import type { ProfileAuthentication } from '../../../../server/src/core/http-server/profile-auth-contract'
import { PROFILE_AUTH_QUERY_KEY, profileAuthQueryOptions } from './profile-query'

export { PROFILE_AUTH_QUERY_KEY } from './profile-query'

const ProfileContext = createContext('')

/**
 * Scopes conversation and selector caches to the authenticated profile.
 */
export function useProfile(): string {
  return useContext(ProfileContext)
}

/**
 * Keeps the frame and local drafts mounted during identity resolution. A different
 * authenticated profile receives fresh component state as well as separate caches.
 */
export function ProfileBoundary({ children }: { children: ReactNode }) {
  const auth = useQuery(profileAuthQueryOptions)
  const profile = auth.data?.authenticated ? auth.data.profile_name ?? '' : ''
  const [scope, setScope] = useState({ profile: '', revision: 0 })
  if (profile && profile !== scope.profile) {
    setScope({ profile, revision: scope.profile ? scope.revision + 1 : scope.revision })
  }

  return (
    <ProfileContext value={profile}>
      <Fragment key={scope.revision}>{children}</Fragment>
    </ProfileContext>
  )
}

/**
 * Only confirmed sign-out replaces the route with a login form. A failed startup
 * probe leaves drafting available while protected queries remain disabled.
 */
export function ProfileAccessGate({ children }: { children: ReactNode }) {
  const auth = useQuery(profileAuthQueryOptions)
  if (auth.data?.authenticated === false) {
    return <ProfileSignIn />
  }

  return (
    <>
      {(auth.isError || auth.fetchStatus === 'paused') && !auth.data && (
        <RequestFeedback error={auth.error} paused={auth.fetchStatus === 'paused'}
          retrying={auth.isFetching} retryLabel="Retry connection" onRetry={() => void auth.refetch()} />
      )}
      {children}
    </>
  )
}

function ProfileSignIn() {
  const { showToast } = useToast()
  const [token, setToken] = useState('')
  const [allowComputerUse, setAllowComputerUse] = useState(false)
  const setup = useQuery({ queryKey: ['desktop-computer-use-setup'],
    queryFn: ({ signal }) => getDesktopComputerUseSetup(signal), enabled: isDesktopClient(),
    retry: false, staleTime: Infinity, meta: { errorToast: false } })
  const login = useMutation({
    meta: { errorTitle: 'Could not sign in' },
    mutationFn: async () => {
      const result = await requestAPI<ProfileAuthentication>('profile-auth', {
        method: 'POST', body: JSON.stringify({ token })
      })
      if (result.authenticated && setup.data && allowComputerUse) {
        await enableDesktopComputerUse(DesktopComputerUseApproval.Setup).catch((error: Error) => {
          showToast({ type: 'error', title: 'Could not enable computer use', description: error.message })
        })
      }

      return result
    },
    onSuccess: (result) => {
      queryClient.removeQueries({ predicate: (query): boolean => query.queryKey[0] !== PROFILE_AUTH_QUERY_KEY[0] })
      queryClient.setQueryData(PROFILE_AUTH_QUERY_KEY, result)
      setToken('')
    }
  })

  return (
    <form aria-label="Connect to Leon" onSubmit={(event) => {
      event.preventDefault()
      login.mutate()
    }}>
      <h1>Connect to your Leon profile</h1>
      {setup.data && <>
        <p>{setup.data.server}</p>
        <Selection multiple label="Allow computer use on this computer" checked={allowComputerUse}
          description="This server can view my screen and send mouse and keyboard input while Leon Desktop is open."
          onChange={(event) => setAllowComputerUse(event.target.checked)} disabled={login.isPending} />
      </>}
      <Input
        ariaLabel="Profile token"
        placeholder="Profile token"
        type="password"
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />
      <Button type="submit" variant="primary" disabled={!token.trim()} loading={login.isPending}>
        Connect
      </Button>
      {login.isError && <p role="alert">{login.error.message}</p>}
    </form>
  )
}
