import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { createDesktopUpdater } from '../.generated/src/updates.js'

class Engine extends EventEmitter {
  checks = 0
  installs = 0
  async checkForUpdates() {
    this.checks++
    this.emit('checking-for-update')
    this.emit('update-available', { version: '0.1.1', releaseNotes: 'Native improvements.' })
    return { downloadPromise: this.downloadUpdate() }
  }
  async downloadUpdate() {
    this.emit('download-progress', { transferred: 32, total: 64 })
    this.emit('update-downloaded', { version: '0.1.1' })
  }
  quitAndInstall() {
    this.installs++
  }
}

test('pins a verified desktop download until an explicit matching restart, independently of the server', async () => {
  const engine = new Engine()
  const stoppedCore = false
  const updater = createDesktopUpdater({ engine, currentVersion: '0.1.0', beforeInstall: () => {
    assert.equal(stoppedCore, false)
  } })
  try {
    assert.equal(engine.autoInstallOnAppQuit, false)
    await updater.check()
    assert.equal(updater.state.phase, 'ready')
    assert.throws(() => updater.download('0.1.2'))
    assert.equal(updater.state.phase, 'ready')
    await updater.check()
    assert.equal(engine.checks, 1)
    await assert.rejects(updater.install('0.1.2'))
    await updater.install('0.1.1')
    assert.equal(engine.installs, 1)
    assert.equal(stoppedCore, false)
  } finally {
    updater.close()
  }
  assert.equal(engine.listenerCount('error'), 0)
})

test('never installs a failed or mismatched desktop package', async () => {
  const engine = new Engine()
  engine.downloadUpdate = async () => {
    engine.emit('error', new Error('Signature verification failed'))
    throw new Error('Signature verification failed')
  }
  const updater = createDesktopUpdater({ engine, currentVersion: '0.1.0' })
  try {
    await updater.check()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(updater.state.phase, 'failed')
    await assert.rejects(updater.install('0.1.1'))
    assert.equal(engine.installs, 0)
    engine.emit('update-downloaded', { version: '0.1.2' })
    assert.equal(updater.state.phase, 'failed')
  } finally {
    updater.close()
  }
})

test('leaves unsigned local builds and externally managed installations without automatic writes', async () => {
  const updater = createDesktopUpdater({ currentVersion: '0.1.0', reason: 'Updates are unavailable.' })
  assert.equal(updater.state.supported, false)
  assert.throws(() => updater.check(), /unavailable/)
  await assert.rejects(updater.install('0.1.1'))
  updater.close()
})
