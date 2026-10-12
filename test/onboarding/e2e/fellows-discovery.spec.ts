import { expect, it } from 'vitest'

import { discoverFellows, FellowAuthType } from '@/core/llm-manager/fellows/fellow-discovery'

it('discovers AI fellows on the current machine without connecting accounts', async () => {
  const discovery = await discoverFellows()

  expect(Array.isArray(discovery.fellows)).toBe(true)
  expect(Array.isArray(discovery.connections)).toBe(true)
  expect(new Set(discovery.connections.map((connection) => connection.id)).size)
    .toBe(discovery.connections.length)

  for (const connection of discovery.connections) {
    expect(connection.sources.length).toBeGreaterThan(0)
    expect(Object.values(FellowAuthType)).toContain(connection.authType)
    expect(connection.model).not.toBe('')
    expect(Object.keys(connection)).not.toContain('api_key')
    expect(Object.keys(connection)).not.toContain('access_token')
  }

  // Display only public discovery metadata, never paths, keys, tokens, or identities.
  console.info(`Fellows: ${discovery.fellows.join(', ') || 'none'}`)
  for (const connection of discovery.connections) {
    console.info(`${connection.provider} · ${connection.authType} · ${connection.sources.join(', ')}`)
  }
  console.info(`Connections: ${discovery.connections.length}; unreadable settings: ${discovery.issues.length}`)
})
