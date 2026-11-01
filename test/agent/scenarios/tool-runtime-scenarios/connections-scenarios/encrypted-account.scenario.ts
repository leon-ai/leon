import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run(context) {
    const { CONNECTION_STORE, ConnectionStatus } = await import('@/core/connections/connection-store')
    const provider = 'communication.gmail'
    const secret = 'scenario-secret-never-in-public-metadata'
    const summary = await CONNECTION_STORE.save({ provider, auth_type: 'api_key', credentials: { api_key: secret }, account_label: 'Test account' })
    assert.equal(summary.status, ConnectionStatus.Connected)
    assert.ok(!JSON.stringify(await CONNECTION_STORE.list()).includes(secret))
    const disk = await fs.readFile(path.join(context.profilePath, 'connections', `${provider}.json`), 'utf8')
    assert.ok(!disk.includes(secret), 'Credentials must be encrypted at rest.')
    assert.equal((await CONNECTION_STORE.getCredentials(provider))?.['api_key'], secret)
    await CONNECTION_STORE.markNeedsAttention(provider)
    assert.equal((await CONNECTION_STORE.list()).find((entry) => entry.provider === provider)?.status, ConnectionStatus.NeedsAttention)
    await CONNECTION_STORE.remove(provider)
    assert.equal(await CONNECTION_STORE.getCredentials(provider), null)

    return { provider, encrypted: true, revoked: true }
  }
}

export default scenario
