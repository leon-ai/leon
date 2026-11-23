import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClientURL } from '../.generated/src/startup.js'

test('a transient initial navigation failure retries the same private entry once', async () => {
  const urls = []
  const entry = 'http://127.0.0.1:5366/private-entry'
  const target = { isDestroyed: () => false, loadURL: async (url) => {
    urls.push(url)
    if (urls.length === 1) {
      throw Object.assign(new Error('Network service restarted'), { errno: -2 })
    }
  } }
  await loadClientURL(target, entry)
  assert.deepEqual(urls, [entry, entry])
})

test('persistent navigation failures stop after one retry and other errors propagate immediately', async () => {
  for (const code of [-2, -3, -105]) {
    let calls = 0
    const error = Object.assign(new Error('Navigation failed'), { errno: code })
    await assert.rejects(loadClientURL({ isDestroyed: () => false, loadURL: async () => {
      calls++
      throw error
    } }, 'http://127.0.0.1:5366/'), (result) => result === error)
    assert.equal(calls, code === -2 ? 2 : 1)
  }
})
