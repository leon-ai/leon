import { AsyncLocalStorage } from 'node:async_hooks'

import { TurnClientOS, TurnClientType, type TurnClient } from '@@/bridges/runtime/contracts/turn-client'

const clientTypes = Object.values(TurnClientType)
const clientOSFamilies = Object.values(TurnClientOS)
const turnClient = new AsyncLocalStorage<TurnClient>()

/**
 * Carries only the originating client's allowlisted labels through asynchronous turn dispatch.
 */
export function runWithTurnClient<T>(type: unknown, os: unknown, execute: () => T): T {
  return turnClient.run({
    type: clientTypes.find((label) => label === type) ?? TurnClientType.Unknown,
    os: clientOSFamilies.find((label) => label === os) ?? TurnClientOS.Unknown
  }, execute)
}

/**
 * Returns the client that initiated this turn, including a fallback for older integrations.
 */
export function getTurnClient(): TurnClient {
  return turnClient.getStore() ?? { type: TurnClientType.Unknown, os: TurnClientOS.Unknown }
}
