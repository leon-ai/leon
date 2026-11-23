import type { DesktopTurnNotification } from '../../../bridges/runtime/contracts/desktop-client'
import type { HostAPI } from './types.js'

const MAXIMUM_PROFILES = 128
const MAXIMUM_CONTEXT_LENGTH = 256
const MAXIMUM_CONTROL_BYTES = 4_096

/**
 * Authenticates each completion against Core and bounds replay receipts. Native
 * diagnostics record dispatch without displaying banners or requesting focus.
 */
export function completionNotifications({ profile, show, diagnostic = false }: {
  profile: () => Promise<string | null>
  show: (value: DesktopTurnNotification) => boolean
  diagnostic?: boolean
}): HostAPI {
  const receipts = new Map<string, number>()
  const delivered: DesktopTurnNotification[] = []

  return async (request, response, _url, readBody) => {
    if (diagnostic && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(delivered))
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    const value = JSON.parse((await readBody(request, MAXIMUM_CONTROL_BYTES)).toString()) as Partial<DesktopTurnNotification> | null
    if (!value || typeof value.profile !== 'string' || !value.profile || value.profile.length > MAXIMUM_CONTEXT_LENGTH ||
      typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > MAXIMUM_CONTEXT_LENGTH ||
      typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence <= 0) {
      throw Object.assign(new Error('Invalid completion notification'), { status: 400 })
    }
    if (await profile() !== value.profile) {
      throw Object.assign(new Error('This notification belongs to another profile.'), { status: 409 })
    }
    const notification = { profile: value.profile, sessionId: value.sessionId, sequence: value.sequence }
    if (value.sequence > (receipts.get(value.profile) ?? 0) && show(notification)) {
      receipts.delete(value.profile)
      receipts.set(value.profile, value.sequence)
      if (receipts.size > MAXIMUM_PROFILES) {
        receipts.delete(receipts.keys().next().value!)
      }
      if (diagnostic) {
        delivered.push(notification)
        delivered.splice(0, Math.max(0, delivered.length - MAXIMUM_PROFILES))
      }
    }
    response.writeHead(204).end()
  }
}
