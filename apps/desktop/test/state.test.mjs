import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import contract from '../.generated/runtime/desktop-contract.mjs'
import { createDesktopState } from '../.generated/src/state.js'

function cookieSession(initial = []) {
  const cookies = new EventEmitter()
  let values = initial
  cookies.get = async () => values
  cookies.set = async (cookie) => {
 values = [...values, cookie] 
}
  cookies.clear = () => {
    values = []
    cookies.emit('changed')
  }

  return { cookies }
}

// An authenticated encryption codec exercises storage/restore without requesting
// access to the owner's OS keychain during background checks.
function encryption() {
  const key = randomBytes(32)

  return {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    async encryptStringAsync(value) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])

      return Buffer.concat([nonce, cipher.getAuthTag(), data])
    },
    async decryptStringAsync(value) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))

      return { result: Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString(), shouldReEncrypt: false }
    }
  }
}

test('restores backend appearance before window creation and reports only effective preference changes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-theme-'))
  const backend = new URL('http://localhost:5366')
  const options = { directory, backend, session: cookieSession(), safeStorage: undefined, ephemeral: false }
  let changes = 0
  const state = await createDesktopState({ ...options, onColorSchemeChange: () => changes++ })

  try {
    assert.equal(state.colorScheme, 'dark')
    await state.update({ 'leon.web-app.theme': 'light' })
    assert.equal(state.colorScheme, 'light')
    await state.update({ 'leon.web-app.theme': 'light', 'leon.web-app.sounds-enabled': 'false' })
    assert.equal(changes, 1)
    await assert.rejects(async () => state.update({ 'leon.web-app.theme': 'dark', secret: 'invalid' }))
    assert.equal(state.colorScheme, 'light')
    assert.equal(changes, 1)
    await state.close()

    const restored = await createDesktopState(options)
    assert.equal(restored.colorScheme, 'light')
    await restored.update({ 'leon.web-app.theme': 'system' })
    assert.equal(restored.colorScheme, 'system')
    await restored.update({ 'leon.web-app.theme': 'unsupported' })
    assert.equal(restored.colorScheme, 'dark')
    await restored.close()

    const other = await createDesktopState({ ...options, backend: new URL('http://localhost:5367') })
    assert.equal(other.colorScheme, 'dark')
    await other.close()
  } finally {
    await state.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('restores encrypted desktop sessions and profile preferences, isolates backends and persists sign-out', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-state-'))
  const backend = new URL('http://127.0.0.1:5366')
  const safeStorage = encryption()
  const secret = 'private-session-credential'
  const session = cookieSession([{ name: contract.profileCookieName, value: secret, path: '/', httpOnly: true, session: true }])
  const open = (session, origin = backend) => createDesktopState({ directory, backend: origin, session, safeStorage, ephemeral: false })
  try {
    const first = await open(session)
    await first.update({ 'leon.web-app.theme': 'dark', 'leon.web-app.recent-models.owner': '[]' })
    await assert.rejects(async () => first.update({ token: secret }))
    session.cookies.emit('changed')
    await first.close()
    const [identity] = await readdir(path.join(directory, 'servers'))
    const encrypted = await readFile(path.join(directory, 'servers', identity, 'cookies.enc'))
    assert.equal(encrypted.includes(secret), false)
    const restoredSession = cookieSession()
    const restored = await open(restoredSession)
    assert.equal((await restoredSession.cookies.get())[0].value, secret)
    assert.ok(restored.bootstrap().includes('leon.web-app.recent-models.owner'))
    const otherSession = cookieSession()
    const other = await open(otherSession, new URL('http://127.0.0.1:5367'))
    assert.deepEqual(await otherSession.cookies.get(), [])
    assert.equal(other.bootstrap().includes('recent-models.owner'), false)
    await other.close()
    restoredSession.cookies.clear()
    await restored.close()
    const signedOut = cookieSession()
    const reopened = await open(signedOut)
    assert.deepEqual(await signedOut.cookies.get(), [])
    await reopened.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('keeps authentication in memory when secure storage is unavailable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-state-'))
  try {
    const session = cookieSession([{ name: contract.profileCookieName, value: 'private', session: true }])
    const state = await createDesktopState({ directory, backend: new URL('http://localhost:5366'), session,
      safeStorage: { isAsyncEncryptionAvailable: async () => false }, ephemeral: false })
    session.cookies.emit('changed')
    await state.close()
    const [identity] = await readdir(path.join(directory, 'servers'))
    assert.deepEqual(await readdir(path.join(directory, 'servers', identity)), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('anonymous cookies and preferences never initialize the OS credential store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-state-'))
  let prompts = 0
  const safeStorage = { isAsyncEncryptionAvailable: async () => {
    prompts++
    return true
  } }
  const backend = new URL('http://localhost:5366')
  try {
    const session = cookieSession([{ name: 'unrelated-cookie', value: 'public', session: true }])
    const state = await createDesktopState({ directory, backend, session, safeStorage, ephemeral: false })
    await state.update({ 'leon.web-app.theme': 'dark' })
    session.cookies.emit('changed')
    await state.close()
    const restored = await createDesktopState({ directory, backend, session: cookieSession(), safeStorage, ephemeral: false })
    assert.ok(restored.bootstrap().includes('dark'))
    assert.equal(prompts, 0)
    const [identity] = await readdir(path.join(directory, 'servers'))
    assert.deepEqual(await readdir(path.join(directory, 'servers', identity)), ['preferences.json'])
    await restored.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('credential-store denial is cached while preferences and the current session keep working', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-state-'))
  let prompts = 0
  try {
    const session = cookieSession([{ name: contract.profileCookieName, value: 'private', session: true }])
    const state = await createDesktopState({ directory, backend: new URL('http://localhost:5366'), session,
      safeStorage: { isAsyncEncryptionAvailable: async () => {
        prompts++
        throw new Error('Owner declined secure storage')
      } }, ephemeral: false })
    session.cookies.emit('changed')
    session.cookies.emit('changed')
    await state.update({ 'leon.web-app.accent': 'violet' })
    await state.close()
    assert.equal(prompts, 1)
    assert.equal((await session.cookies.get())[0].value, 'private')
    const [identity] = await readdir(path.join(directory, 'servers'))
    assert.deepEqual(await readdir(path.join(directory, 'servers', identity)), ['preferences.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('memory-only authentication preserves preferences and previously encrypted credentials', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-state-'))
  const backend = new URL('http://localhost:5366')
  try {
    const savedSession = cookieSession([{ name: contract.profileCookieName, value: 'retained', session: true }])
    const retained = await createDesktopState({ directory, backend,
      session: savedSession,
      safeStorage: encryption(), ephemeral: false })
    // Save a real encrypted fixture before opening a local memory-only host.
    savedSession.cookies.emit('changed')
    await retained.close()
    const [identity] = await readdir(path.join(directory, 'servers'))
    const cookiesFile = path.join(directory, 'servers', identity, 'cookies.enc')
    const encrypted = await readFile(cookiesFile)
    const session = cookieSession([{ name: contract.profileCookieName, value: 'memory-only', session: true }])
    const state = await createDesktopState({ directory, backend, session, safeStorage: undefined, ephemeral: false })
    session.cookies.emit('changed')
    await state.update({ 'leon.web-app.theme': 'light' })
    await state.close()
    const files = await readdir(path.join(directory, 'servers', identity))
    assert.deepEqual(files.sort(), ['cookies.enc', 'preferences.json'])
    assert.deepEqual(await readFile(cookiesFile), encrypted)
    assert.ok(!(await readFile(path.join(directory, 'servers', identity, 'preferences.json'), 'utf8')).includes('memory-only'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

for (const operation of ['restore', 'save']) {
  test(`a failed credential ${operation} preserves encrypted data and suppresses repeated OS requests`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-state-'))
    const backend = new URL('http://localhost:5366')
    const codec = encryption()
    try {
      const savedSession = cookieSession([{ name: contract.profileCookieName, value: 'retained', session: true }])
      const first = await createDesktopState({ directory, backend, session: savedSession, safeStorage: codec, ephemeral: false })
      savedSession.cookies.emit('changed')
      await first.close()
      const [identity] = await readdir(path.join(directory, 'servers'))
      const filename = path.join(directory, 'servers', identity, 'cookies.enc')
      const previous = await readFile(filename)
      let requests = 0
      const method = operation === 'restore' ? 'decryptStringAsync' : 'encryptStringAsync'
      const safeStorage = { ...codec, [method]: async () => {
        requests++
        throw new Error('Credential store is locked')
      } }
      const session = cookieSession([{ name: contract.profileCookieName, value: 'current', session: true }])
      const state = await createDesktopState({ directory, backend, session, safeStorage, ephemeral: false })
      session.cookies.emit('changed')
      session.cookies.emit('changed')
      await state.update({ 'leon.web-app.theme': 'dark' })
      await state.close()
      assert.equal(requests, 1)
      assert.deepEqual(await readFile(filename), previous)
      assert.ok(state.bootstrap().includes('dark'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test('refreshes encrypted credentials when the OS requests key rotation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-state-'))
  const backend = new URL('http://localhost:5366')
  const codec = encryption()
  try {
    const session = cookieSession([{ name: contract.profileCookieName, value: 'retained', session: true }])
    const first = await createDesktopState({ directory, backend, session, safeStorage: codec, ephemeral: false })
    session.cookies.emit('changed')
    await first.close()
    const [identity] = await readdir(path.join(directory, 'servers'))
    const filename = path.join(directory, 'servers', identity, 'cookies.enc')
    const previous = await readFile(filename)
    const restored = await createDesktopState({ directory, backend, session: cookieSession(), ephemeral: false,
      safeStorage: { ...codec, decryptStringAsync: async (bytes) => ({
        ...await codec.decryptStringAsync(bytes), shouldReEncrypt: true
      }) } })
    await restored.close()
    const rotated = await readFile(filename)
    assert.notDeepEqual(rotated, previous)
    assert.equal(rotated.includes('retained'), false)
    assert.equal(JSON.parse((await codec.decryptStringAsync(rotated)).result)[0].value, 'retained')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
