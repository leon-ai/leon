import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'

import { chromium } from '@playwright/test'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    const directory = path.join(profilePath, 'tools', 'browser_use', 'browser-use')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({
      user_data_dir: path.join(profilePath, 'browser-fixture'), cdp_endpoint: ''
    }))
  },
  async run(context) {
    let submissions = 0
    let submittedName = ''
    const server = createServer(async (request, response) => {
      if (request.method === 'POST' && request.url === '/submit') {
        let body = ''
        for await (const chunk of request) {
          body += chunk.toString()
        }
        submissions += 1
        submittedName = new URLSearchParams(body).get('name') || ''
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end('<h1>Saved handoff</h1><p>Confirmation: SPRUCE-42</p>')
      } else {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end('<h1>Caldera handoff</h1><form method="post" action="/submit"><label>Owner name <input name="name" required></label><button type="submit">Save handoff</button></form>')
      }
    })
    const listening = once(server, 'listening')
    server.listen(0, '127.0.0.1')
    await listening
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined
    try {
      browser = await chromium.launchPersistentContext(path.join(context.profilePath, 'browser-fixture'), {
        headless: true, args: ['--remote-debugging-port=0']
      })
      const turn = await context.runTurn(`Use the browser tool in a new tab to open http://127.0.0.1:${address.port}/. Inspect the form, enter Nora as owner name and click Save handoff once. Verify the resulting page and tell me the confirmation code. Use observed controls and browser actions; do not submit through fetch, direct HTTP or shell. Close only this fixture tab after verification.`)
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.equal(submissions, 1)
      assert.equal(submittedName, 'Nora')
      assert.ok(turn.output.includes('SPRUCE-42'))
      assert.ok(turn.executionHistory.some((entry) => entry.function.startsWith('browser_use.browser-use.')))
      assert.ok(!turn.executionHistory.some((entry) => entry.function.startsWith('computer_use.') || entry.function.startsWith('operating_system_control.')))

      return { turn, submissions, browser: 'Disposable headless Chromium profile; local fixture only.' }
    } finally {
      await browser?.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }
}

export default scenario
