import type { DriverAuthorizationHost, DriverAuthorizationDecision } from '@trycua/cua-driver'

import { parseJsonRecord } from '../utils'

const CUA_AUTHORIZATION_SCHEMA = 'cua-driver-authorization-request-v1'
const CUA_EXISTING_PROFILE_ADAPTER = 'browser_prepare.existing_profile'

/** Applies the owner's profile-inspection grant only to Cua's attested browser boundary. */
export async function createCuaBrowserAuthorizationHost(
  isAllowed: () => boolean
): Promise<DriverAuthorizationHost> {
  const { DriverAuthorizationAction } = await import('@trycua/cua-driver')
  return {
    async authorize(request): Promise<DriverAuthorizationDecision> {
      // Cua verifies the process/window/endpoint before this callback and binds
      // the decision to its digest. Never log the protected identity or send it to the model.
      const resource = parseJsonRecord(request.resourceJson)
      const allowed = isAllowed() &&
        request.schema === CUA_AUTHORIZATION_SCHEMA &&
        request.adapterId === CUA_EXISTING_PROFILE_ADAPTER &&
        request.permissionMode === 'standard' &&
        request.riskClass === 'r2' &&
        request.expiresUnixMs > BigInt(Date.now()) &&
        Boolean(request.requestDigest) &&
        Number.isInteger(resource?.['pid']) && Number(resource?.['pid']) > 0 &&
        Number.isInteger(resource?.['window_id']) && Number(resource?.['window_id']) > 0 &&
        resource?.['endpoint_owner_pid'] === resource?.['pid']

      return {
        action: allowed ? DriverAuthorizationAction.Allow : DriverAuthorizationAction.Deny,
        requestDigest: request.requestDigest
      }
    }
  }
}
