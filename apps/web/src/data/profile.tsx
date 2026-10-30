import { createContext, Fragment, useContext, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Button } from '@/components/button'
import { Input } from '@/components/input'
import { queryClient } from '@/query-client'

import { requestAPI } from './api'
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
      {auth.isError && !auth.data && (
        <div role="alert">
          <p>{auth.error.message}</p>
          <Button onClick={() => void auth.refetch()}>Retry connection</Button>
        </div>
      )}
      {children}
    </>
  )
}

function ProfileSignIn() {
  const [token, setToken] = useState('')
  const login = useMutation({
    meta: { errorTitle: 'Could not sign in' },
    mutationFn: () => requestAPI<ProfileAuthentication>('profile-auth', {
      method: 'POST', body: JSON.stringify({ token })
    }),
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
