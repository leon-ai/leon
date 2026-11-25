import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'

import type { Session } from 'electron'
import {
  COMPUTER_USE_DEVICE_TOOL, DESKTOP_SATELLITE_ENV, DESKTOP_SATELLITE_READY, DESKTOP_SATELLITE_REJECTED, type DeviceGrant
} from '../../../bridges/runtime/contracts/device-execution'
import type { DesktopComputerUseSetup } from '../../../bridges/runtime/contracts/desktop-client'
import { readBackendJSON, requestBackend } from './backend.js'
import { desktopSessionEnvironment } from './desktop-session.js'
import type { DesktopState } from './state.js'
import type { DesktopDeviceRuntime } from './types.js'
import contract from '../runtime/desktop-contract.mjs'

const STARTUP_TIMEOUT_MS = 20_000
const STOP_TIMEOUT_MS = 5_000
const TURN_READINESS_WAIT_MS = 2_000
const DEVICE_ROUTE = '/api/v1/devices'
export const BROWSER_USE_DEVICE_TOOL = 'browser_use.browser-use'

interface DesktopDevice {
  connect: (tools?: string[]) => Promise<void>
  setup: () => DesktopComputerUseSetup | null
  enable: (confirm: boolean) => Promise<boolean>
  credential: () => Promise<string | undefined>
  disable: () => Promise<void>
  close: () => Promise<void>
}

/**
 * Keeps the scoped credential and the graphical worker in the native host.
 */
export function createDesktopDevice({ backend, session, state, runtime, ownerCredential, managed, authorize }: {
  backend: string
  session: Session
  state: DesktopState
  runtime: (signal: AbortSignal) => Promise<DesktopDeviceRuntime>
  ownerCredential: (backend: string) => Promise<string | undefined>
  managed: () => boolean
  authorize: () => Promise<boolean>
}): DesktopDevice {
  let grant: DeviceGrant | undefined
  let worker: ChildProcess | undefined
  let starting: AbortController | undefined
  let pending: Promise<void> | undefined
  let provisioning = false
  let ready = false

  async function ownerHeaders(): Promise<Record<string, string>> {
    const cookies = await session.cookies.get({ url: backend, name: contract.profileCookieName })
    if (cookies.length > 0) {
      return {}
    }
    const token = await ownerCredential(backend)

    return token ? { authorization: 'Bearer ' + token } : {}
  }

  async function profile(): Promise<string | undefined> {
    const { response } = requestBackend({
      session, headers: await ownerHeaders(), url: new URL('/api/v1/profile-auth', backend)
    })
    const auth = await readBackendJSON(await response)

    return auth['authenticated'] === true && typeof auth['profile_name'] === 'string'
      ? auth['profile_name'] : undefined
  }

  async function stop(): Promise<void> {
    const current = worker
    worker = undefined
    ready = false
    if (!current || current.exitCode !== null || current.signalCode !== null) {
      return
    }

    const exited = once(current, 'exit', { signal: AbortSignal.timeout(STOP_TIMEOUT_MS) })
    if (current.connected) {
      current.disconnect()
    } else {
      current.kill()
    }
    await exited.catch(() => {
      current.kill()
    })
  }

  async function start(selected: DeviceGrant, install: DesktopDeviceRuntime, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const child = spawn(install.node, [path.join(install.root, 'server/dist/satellite.js')], {
      cwd: install.root,
      env: { ...process.env, ...install.environment, ...desktopSessionEnvironment(),
        LEON_NODE_ENV: 'production', LEON_SATELLITE_REMOTE_URL: backend, [DESKTOP_SATELLITE_ENV]: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true
    })
    worker = child
    child.on('error', () => {
      ready = false
    })
    child.on('exit', () => {
      if (worker === child) {
        worker = undefined
        ready = false
      }
    })
    child.on('message', (message) => {
      if (worker === child && message === DESKTOP_SATELLITE_REJECTED) {
        ready = false
      }
    })
    const startup = AbortSignal.any([signal, AbortSignal.timeout(STARTUP_TIMEOUT_MS)])
    const handshake = Promise.race([
      once(child, 'message', { signal: startup }).then(([message]) => message),
      once(child, 'exit', { signal: startup }).then(() => undefined)
    ])
    child.send(selected, (error) => {
      if (error) {
        child.kill()
      }
    })
    if (await handshake !== DESKTOP_SATELLITE_READY || worker !== child) {
      throw new Error('I could not connect this computer. Check that the server supports device pairing.')
    }

    ready = true
  }

  async function revoke(selected: DeviceGrant): Promise<void> {
    const { response } = requestBackend({
      session, method: 'DELETE', headers: await ownerHeaders(),
      url: new URL(DEVICE_ROUTE + '/' + selected.id, backend)
    })
    const result = await response
    result.resume()
    if (result.statusCode !== 204) {
      throw new Error('I could not revoke this computer. Sign in to your profile on that server and retry.')
    }
  }

  async function connectDevice(signal: AbortSignal, requested?: string[]): Promise<void> {
    let paired: DeviceGrant | undefined

    try {
      const name = await profile()
      signal.throwIfAborted()
      if (!name) {
        if (requested) {
          throw new Error('Sign in to Leon before enabling this computer.')
        }
        return
      }
      if (grant && grant.profile !== name) {
        await stop()
        grant = undefined
      }
      const saved = grant ?? await state.loadDeviceGrant(name)
      const permission = await state.readDevicePermission(name)
      if (!requested && permission === false) {
        return
      }
      if (ready && saved && (!requested || requested.length === saved.tools.length &&
        requested.every((tool) => saved.tools.includes(tool)))) {
        return
      }
      if (!requested && !saved && !managed() && permission !== true) {
        return
      }
      if (requested) {
        signal.throwIfAborted()
        await state.saveDevicePermission(name, true)
      }

      provisioning = true
      const tools = requested ?? (saved ? undefined : [COMPUTER_USE_DEVICE_TOOL])
      const install = await runtime(signal)
      signal.throwIfAborted()
      if (tools) {
        const body = JSON.stringify({ name: os.hostname().slice(0, 120), tools })
        const { response } = requestBackend({
          session, method: 'POST', url: new URL(DEVICE_ROUTE, backend),
          headers: { ...await ownerHeaders(), 'content-type': 'application/json' },
          body: Readable.from([body]), maximumBytes: Buffer.byteLength(body), signal
        })
        const reply = await response
        const data = await readBackendJSON(reply)
        if (reply.statusCode !== 201 || typeof data['id'] !== 'string' || typeof data['credential'] !== 'string') {
          throw new Error(typeof data['message'] === 'string' ? data['message'] : 'I could not pair this computer.')
        }
        paired = { id: data['id'], credential: data['credential'], profile: name, tools }
      }

      const selected = paired ?? saved!
      await stop()
      await start(selected, install, signal)
      grant = selected
      await state.saveDeviceGrant(name, grant).catch(console.error)
      if (paired && saved) {
        await revoke(saved).catch(console.error)
      }
    } catch (error) {
      if (provisioning && !ready) {
        await stop()
      }
      if (paired) {
        await revoke(paired).catch(console.error)
      }
      if (!signal.aborted) {
        throw error
      }
    } finally {
      provisioning = false
    }
  }

  function connect(tools?: string[]): Promise<void> {
    if (pending) {
      return tools || starting?.signal.aborted
        ? pending.catch(() => undefined).then(() => connect(tools))
        : pending
    }
    const controller = new AbortController()
    starting = controller
    pending = connectDevice(controller.signal, tools).finally(() => {
      starting = undefined
      pending = undefined
    })

    return pending
  }

  const authChanged = (_event: unknown, cookie: Electron.Cookie, _cause: string, removed: boolean): void => {
    if (cookie.name !== contract.profileCookieName) {
      return
    }
    if (removed) {
      starting?.abort()
      void stop()
    } else {
      void connect().catch(console.error)
    }
  }
  session.cookies.on('changed', authChanged)

  return {
    connect,
    setup: () => managed() ? null : { server: new URL(backend).origin },
    async enable(confirm): Promise<boolean> {
      const name = await profile()
      if (!name) {
        throw Object.assign(new Error('Sign in before enabling computer use.'), { status: 401 })
      }
      const allowed = await state.readDevicePermission(name)
      if (confirm && allowed !== true && !managed() &&
        (allowed === false || !await state.loadDeviceGrant(name)) && !await authorize()) {
        return false
      }
      if (await profile() !== name) {
        throw Object.assign(new Error('I changed profiles before enabling computer use. Please try again.'), { status: 409 })
      }

      await state.saveDevicePermission(name, true)
      // A sign-in probe may have started before the setup choice was saved.
      await pending?.catch(() => undefined)
      if (confirm) {
        await connect()
      } else {
        void connect().catch(console.error)
      }
      return true
    },
    async credential(): Promise<string | undefined> {
      // Join ordinary local startup briefly without holding chat for remote
      // consent or for a runtime download.
      if (!ready && pending && (managed() || provisioning)) {
        const deadline = new AbortController()
        try {
          await Promise.race([pending.catch(() => undefined), delay(TURN_READINESS_WAIT_MS, undefined, { signal: deadline.signal })])
        } finally {
          deadline.abort()
        }
      }

      return ready ? grant?.credential : undefined
    },
    async disable(): Promise<void> {
      const name = await profile()
      if (!name) {
        throw new Error('Sign in to revoke this computer.')
      }
      await state.saveDevicePermission(name, false)
      starting?.abort()
      await stop()
      await pending?.catch(() => undefined)
      const selected = grant?.profile === name ? grant : await state.loadDeviceGrant(name)
      if (selected) {
        await revoke(selected)
      }
      grant = undefined
      await state.saveDeviceGrant(name)
    },
    async close(): Promise<void> {
      session.cookies.off('changed', authChanged)
      starting?.abort()
      await stop()
    }
  }
}
