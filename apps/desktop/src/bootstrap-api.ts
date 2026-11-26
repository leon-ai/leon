import { DESKTOP_BOOTSTRAP_PATH } from '../../../bridges/runtime/contracts/desktop-client'
import type { createBootstrap } from './bootstrap.js'
import type { HostAPI } from './types.js'

const MAXIMUM_CONTROL_BYTES = 4_096

/**
 * Exposes bounded controls and event-driven state inside the authenticated gateway.
 */
export function bootstrapAPI(controller: Awaited<ReturnType<typeof createBootstrap>>, { openLogs }: {
  openLogs: (filename: string | undefined) => Promise<void>
}): HostAPI {
  return async (request, response, url, readBody) => {
    const action = url.pathname.slice(DESKTOP_BOOTSTRAP_PATH.length)
    if (request.method === 'GET' && action === 'events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      let blocked = false
      const send = (): void => {
        if (!blocked) {
          blocked = !response.write(`data: ${JSON.stringify(controller.store.state)}\n\n`)
        }
      }
      const drain = (): void => {
        blocked = false
        send()
      }
      controller.store.events.on('change', send)
      response.on('drain', drain)
      request.on('close', () => {
        controller.store.events.off('change', send)
        response.off('drain', drain)
      })
      send()
      return
    }
    if (request.method === 'GET' && action === 'state') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(controller.store.state))
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    const body = JSON.parse((await readBody(request, MAXIMUM_CONTROL_BYTES)).toString() || '{}')
    if (action === 'start') {
      void controller.start()
    } else if (action === 'cancel') {
      controller.cancel()
    } else if (action === 'startup' && typeof body.enabled === 'boolean') {
      await controller.setStartup(body.enabled).catch((error) => {
        throw Object.assign(error, { status: 400 })
      })
    } else if (action === 'stop') {
      await controller.stop()
    } else if (action === 'logs') {
      await openLogs(controller.log)
    } else {
      response.writeHead(404).end()
      return
    }
    response.writeHead(204).end()
  }
}
