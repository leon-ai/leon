import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// Static requests use the actual gateway without forwarding through Electron.
const electron = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const net = undefined',
        shortCircuit: true
      }
    }

    return next(specifier, context)
  }
})
const { createGateway } = await import('../.generated/src/gateway.js').finally(() => electron.deregister())

async function fixtureFrontend(root, entry) {
  await mkdir(path.join(root, 'assets'), { recursive: true })
  await writeFile(path.join(root, 'index.html'),
    `<html><head><script type="module" src="/web-app/assets/${entry}.js"></script></head></html>`)
  await writeFile(path.join(root, 'assets', `${entry}.js`), `export default '${entry}'`)
}

test('a startup page retains its assets until navigation opens the ready frontend', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'leon-frontend-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bundled = path.join(directory, 'bundled')
  const managed = path.join(directory, 'managed')
  await Promise.all([fixtureFrontend(bundled, 'setup-entry'), fixtureFrontend(managed, 'client-entry')])

  let phase = 'running'
  const gateway = await createGateway({
    async frontend() {
      const root = phase === 'complete' ? managed : bundled

      // Core may become ready while the bundled document is being prepared.
      phase = 'complete'
      return root
    },
    bootstrapPhase: () => phase
  })
  t.after(() => gateway.close())

  const entry = await fetch(gateway.entry, { redirect: 'manual' })
  assert.equal(entry.status, 303)
  const cookie = entry.headers.getSetCookie()[0].split(';')[0]
  const navigation = { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' }
  const request = (route, options = {}) => fetch(new URL(route, gateway.origin), {
    ...options,
    headers: { cookie, ...options.headers }
  })

  const initial = await request('/web-app/', { headers: navigation }).then((response) => response.text())
  assert.match(initial, /\/web-app\/assets\/setup-entry\.js/)
  assert.equal((await request('/web-app/', { method: 'HEAD' })).status, 200)
  const asset = await request('/web-app/assets/setup-entry.js')
  assert.equal(asset.status, 200)
  assert.equal(await asset.text(), 'export default \'setup-entry\'')
  assert.match(initial, /name="leon-desktop-bootstrap" content="pending"/)

  const reloaded = await request('/web-app/session/example', { headers: navigation }).then((response) => response.text())
  assert.match(reloaded, /\/web-app\/assets\/client-entry\.js/)
  assert.match(reloaded, /name="leon-desktop-bootstrap" content="complete"/)
  const client = await request('/web-app/assets/client-entry.js')
  assert.equal(client.status, 200)
  assert.equal(await client.text(), 'export default \'client-entry\'')
})
