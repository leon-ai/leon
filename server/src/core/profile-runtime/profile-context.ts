import { AsyncLocalStorage } from 'node:async_hooks'

import { LEON_PROFILE_NAME } from '@/leon-roots'

export interface ProfileContext {
  profileName: string
}

const profileContextStorage = new AsyncLocalStorage<ProfileContext>()

/** Return the profile attached to the current request or the legacy startup profile. */
export function getActiveProfileName(): string {
  return profileContextStorage.getStore()?.profileName || LEON_PROFILE_NAME
}

/** Run work inside a profile scope without mutating process-wide environment state. */
export function runWithProfileContext<T>(
  context: ProfileContext,
  callback: () => T
): T {
  return profileContextStorage.run(context, callback)
}

/** Attach the rest of the current asynchronous request chain to a profile. */
export function enterProfileContext(context: ProfileContext): void {
  profileContextStorage.enterWith(context)
}
