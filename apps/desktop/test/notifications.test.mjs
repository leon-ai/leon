import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'

import { completionNotifications } from '../.generated/src/notifications.js'

test('native completion dispatch rejects cross-profile events and suppresses replay without exposing content', async () => {
  let activeProfile = 'owner'
  const banners = []
  const api = completionNotifications({ profile: async () => activeProfile, show: (value) => {
    banners.push(value)
    return true
  } })
  const server = createServer((request, response) => {
    void api(request, response, new URL(request.url, 'http://localhost'), async (input) => {
      const chunks = []
      for await (const chunk of input) {
        chunks.push(chunk)
      }
      return Buffer.concat(chunks)
    }).catch((error) => response.writeHead(error.status ?? 500).end())
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const send = (value) => fetch(`http://127.0.0.1:${server.address().port}`, {
    method: 'POST', body: JSON.stringify(value)
  })
  try {
    const value = { profile: 'owner', sessionId: 'session', sequence: 5 }
    assert.equal((await send({ ...value, profile: 'another-owner' })).status, 409)
    assert.equal((await send({ ...value, sequence: NaN })).status, 400)
    assert.equal((await send(null)).status, 400)
    assert.equal((await send({ ...value, content: 'Private answer content' })).status, 204)
    await send(value)
    await send({ ...value, sequence: 4 })
    assert.deepEqual(banners, [value])
    activeProfile = 'another-owner'
    await send({ ...value, profile: activeProfile, sequence: 1 })
    assert.equal(banners.length, 2)
    assert.deepEqual(Object.keys(banners[0]).sort(), ['profile', 'sequence', 'sessionId'])
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
