import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:net'
import { once } from 'node:events'

import YAML from 'yaml'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

let endpoint: string

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    // An isolated endpoint must allocate its own model instead of borrowing an
    // existing server whose context was chosen under another memory budget.
    const server = createServer()
    const listening = once(server, 'listening')
    server.listen(0, '127.0.0.1')
    await listening
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })

    const configPath = path.join(profilePath, 'config.yml')
    endpoint = `http://127.0.0.1:${address.port}/v1`
    const document = YAML.parseDocument(await fs.readFile(configPath, 'utf8'))
    document.deleteIn(['llm', 'providers', 'llamacpp', 'context_size'])
    document.setIn(['llm', 'providers', 'llamacpp', 'base_url'], endpoint)
    await fs.writeFile(configPath, String(document))
    // Core paths cache configuration before fixture preparation runs.
    const { CONFIG_MANAGER } = await import('@/config')
    CONFIG_MANAGER.reload()
  },
  async run({ profilePath, runTurn }) {
    const { LLM_PROVIDER } = await import('@/core')
    const { CONFIG_MANAGER } = await import('@/config')
    const capacity = await LLM_PROVIDER.getAgentNativeContextWindowTokens()
    assert.ok(capacity, 'This scenario requires a local llama.cpp model.')
    const baseURL = CONFIG_MANAGER.getProviderBaseURL('llamacpp')!
    assert.equal(baseURL, endpoint)
    const headers = { Authorization: `Bearer ${CONFIG_MANAGER.getProviderAPIKey('llamacpp') || 'no-key'}` }
    const props = await fetch(new URL('/props', baseURL), { headers }).then((response) => response.json())
    const models = await fetch(new URL('/v1/models', baseURL), { headers }).then((response) => response.json())
    assert.equal(props.default_generation_settings.n_ctx, capacity)
    assert.ok(capacity <= models.data[0].meta.n_ctx_train)
    const log = await fs.readFile(path.join(profilePath, 'logs', 'llama-server.log'), 'utf8')
    assert.ok(log.includes('Automatic llama.cpp context'))

    const turn = await runTurn('Reply with exactly READY. Do not use tools.')
    assert.equal(turn.finalIntent, 'answer', turn.output)
    assert.ok(turn.output.includes('READY'), turn.output)

    return { endpoint, capacity, modelContext: models.data[0].meta.n_ctx_train, turn }
  }
}

export default scenario
